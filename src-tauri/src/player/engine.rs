use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc::Receiver, Arc, Mutex};
use std::time::{Duration, Instant};

use gstreamer as gst;
use gstreamer::glib;
use gstreamer::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::config::{ReplayGainMode, TransitionMode};
use crate::discord::{DiscordHandle, PresenceData};
use crate::mpris::MprisHandle;
use crate::player::waveform::WaveformHandle;

use super::{Command, PlaybackStatus, PlayerSnapshot, TrackInfo};

const POSITION_INTERVAL: Duration = Duration::from_millis(300);
const MPRIS_POSITION_INTERVAL: Duration = Duration::from_millis(1000);
const DISCORD_REFRESH: Duration = Duration::from_secs(12);
const LEVELS_INTERVAL: Duration = Duration::from_millis(40);
const LEVEL_ELEMENT_NAME: &str = "hush-level";

/// How many consecutive ticks (≈60 ms each) a boundary condition must hold
/// before a fade is allowed to start. Guards against position-query transients.
const BOUNDARY_DEBOUNCE_TICKS: u32 = 5;
/// The window at the end of a track where the gapless switch is expected.
const WRAP_WINDOW: f64 = 3.0;
/// Extra slack on top of the remaining duration before the fallback advance.
const ADVANCE_DEADLINE_MARGIN: f64 = 10.0;
/// After an advance, ignore pipeline position updates while things settle.
const POSITION_SETTLE: Duration = Duration::from_millis(1500);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PositionEvent {
    position: f64,
    duration: f64,
}

#[derive(Clone, Serialize)]
struct ErrorEvent {
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GainEvent {
    applied: Option<f64>,
    mode: ReplayGainMode,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdvancedEvent {
    track_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LevelsEvent {
    peak: f64,
    rms: f64,
}

fn log_line(message: &str) {
    eprintln!("[hush] {message}");

    #[cfg(target_os = "windows")]
    {
        use std::io::Write;

        let dir = std::env::var_os("LOCALAPPDATA")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("app.hush.desktop");
        if std::fs::create_dir_all(&dir).is_ok() {
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("hush.log"))
            {
                let _ = writeln!(file, "{message}");
            }
        }
    }
}

fn emit_error(app: &AppHandle, message: &str) {
    log_line(&format!("playback error: {message}"));
    let _ = app.emit(
        "player://error",
        ErrorEvent {
            message: message.to_string(),
        },
    );
}

fn element_error(name: &str, err: impl std::fmt::Display) -> String {
    format!(
        "Could not create GStreamer element '{name}': {err}. \
         The GStreamer plugins may be missing or could not be loaded."
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FadeGoal {
    /// Fade out, then pause (sleep timer / manual fade-out).
    Pause,
    /// Fade out, then advance to the preloaded track (fade transitions).
    Advance,
    /// Fade from silence up to full volume after a transition.
    FadeIn,
    /// Just ramp and hold (no follow-up action).
    None,
}

#[derive(Clone, Copy)]
struct FadeRamp {
    from: f64,
    to: f64,
    started: Instant,
    duration: Duration,
    goal: FadeGoal,
}

struct Engine {
    app: AppHandle,
    snapshot: Arc<Mutex<PlayerSnapshot>>,
    discord: DiscordHandle,
    mpris: MprisHandle,
    waveforms: WaveformHandle,

    pipeline: Option<gst::Pipeline>,
    volume_el: Option<gst::Element>,
    fade_el: Option<gst::Element>,
    rg_el: Option<gst::Element>,
    uri: Option<String>,

    rg_mode: ReplayGainMode,
    preamp: f64,
    user_volume: f64,
    muted: bool,

    next: Arc<Mutex<Option<(String, TrackInfo)>>>,
    pending_advance: Arc<Mutex<Option<(String, TrackInfo)>>>,
    gapless_enabled: Arc<AtomicBool>,
    prevent_advance: Arc<AtomicBool>,

    /// Preloaded track that playbin has queued; the bookkeeping advance waits
    /// for the stream-start / end-of-track switch.
    awaiting_advance: Option<(String, TrackInfo)>,
    advance_deadline: Instant,
    awaiting_wrap_hits: u32,
    settle_until: Option<Instant>,

    transition_mode: TransitionMode,
    fade_seconds: f64,
    fade_level: f64,
    fade_ramp: Option<FadeRamp>,
    sleep_anchor: Option<f64>,
    boundary_ticks: u32,

    levels_enabled: bool,
    last_levels: Option<(f64, f64)>,
    last_level_emit: Instant,

    last_position_emit: Instant,
    last_mpris_position: Instant,
    last_discord: Instant,
    last_gain: Option<f64>,
}

#[allow(clippy::too_many_arguments)]
pub fn run(
    app: AppHandle,
    rx: Receiver<Command>,
    snapshot: Arc<Mutex<PlayerSnapshot>>,
    discord: DiscordHandle,
    mpris: MprisHandle,
    waveforms: WaveformHandle,
    volume: f64,
    muted: bool,
    replaygain: ReplayGainMode,
    preamp: f64,
    transition_mode: TransitionMode,
    fade_seconds: f64,
) {
    if gst::init().is_err() {
        emit_error(
            &app,
            "GStreamer could not be initialized. Check your GStreamer installation.",
        );
        return;
    }

    let mut engine = Engine {
        app,
        snapshot,
        discord,
        mpris,
        waveforms,
        pipeline: None,
        volume_el: None,
        fade_el: None,
        rg_el: None,
        uri: None,
        rg_mode: replaygain,
        preamp,
        user_volume: volume.clamp(0.0, 1.0),
        muted,
        next: Arc::new(Mutex::new(None)),
        pending_advance: Arc::new(Mutex::new(None)),
        gapless_enabled: Arc::new(AtomicBool::new(
            transition_mode == TransitionMode::Gapless,
        )),
        prevent_advance: Arc::new(AtomicBool::new(false)),
        awaiting_advance: None,
        advance_deadline: Instant::now(),
        awaiting_wrap_hits: 0,
        settle_until: None,
        transition_mode,
        fade_seconds: fade_seconds.clamp(1.0, 8.0),
        fade_level: 1.0,
        fade_ramp: None,
        sleep_anchor: None,
        boundary_ticks: 0,
        levels_enabled: false,
        last_levels: None,
        last_level_emit: Instant::now() - LEVELS_INTERVAL,
        last_position_emit: Instant::now() - POSITION_INTERVAL,
        last_mpris_position: Instant::now() - MPRIS_POSITION_INTERVAL,
        last_discord: Instant::now() - DISCORD_REFRESH,
        last_gain: None,
    };

    engine.mpris.set_volume(engine.user_volume);
    engine.mpris.set_status(PlaybackStatus::Stopped);

    loop {
        match rx.recv_timeout(Duration::from_millis(60)) {
            Ok(command) => engine.handle(command),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
        while let Ok(command) = rx.try_recv() {
            engine.handle(command);
        }
        engine.poll_bus();
        engine.tick();
    }

    engine.teardown();
    engine.discord.clear();
}

impl Engine {
    // ----- snapshot helpers -------------------------------------------------

    fn snap(&self) -> PlayerSnapshot {
        self.snapshot
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    fn mutate(&self, f: impl FnOnce(&mut PlayerSnapshot)) {
        if let Ok(mut guard) = self.snapshot.lock() {
            f(&mut guard);
        }
    }

    fn emit_state(&self) {
        let snapshot = self.snap();
        let _ = self.app.emit("player://state", &snapshot);
    }

    fn emit_position(&self) {
        let snapshot = self.snap();
        let _ = self.app.emit(
            "player://position",
            PositionEvent {
                position: snapshot.position,
                duration: snapshot.duration,
            },
        );
    }

    // ----- command handling ------------------------------------------------

    fn handle(&mut self, command: Command) {
        match command {
            Command::Load {
                url,
                track,
                start_position,
            } => self.load(url, track, start_position),
            Command::Play => self.play(),
            Command::Pause => self.pause(),
            Command::Stop => self.stop(),
            Command::Seek(position) => self.seek(position),
            Command::SeekBy(delta) => {
                let target = (self.snap().position + delta).max(0.0);
                self.seek(target);
            }
            Command::SetVolume(volume) => self.set_volume(volume),
            Command::SetMute(muted) => self.set_mute(muted),
            Command::SetReplayGain(mode) => self.set_replaygain(mode),
            Command::SetPreamp(db) => {
                self.preamp = db;
                if let Some(rg) = self.rg_el.clone() {
                    rg.set_property("pre-amp", db);
                }
            }
            Command::Preload { url, track } => self.preload(url, track),
            Command::ClearPreload => self.clear_preload(),
            Command::SetLevelsEnabled(enabled) => {
                self.levels_enabled = enabled;
                if !enabled {
                    self.last_levels = None;
                }
            }
            Command::SetTransition(mode, seconds) => {
                self.transition_mode = mode;
                self.fade_seconds = seconds.clamp(1.0, 8.0);
                self.gapless_enabled
                    .store(mode == TransitionMode::Gapless, Ordering::Relaxed);
            }
            Command::FadeOut {
                seconds,
                pause_after,
            } => {
                let goal = if pause_after {
                    FadeGoal::Pause
                } else {
                    FadeGoal::None
                };
                self.start_fade(0.0, seconds, goal);
            }
            Command::SleepAtTrackEnd { fade_seconds } => {
                self.sleep_anchor = Some(fade_seconds.clamp(1.0, 60.0));
                self.prevent_advance.store(true, Ordering::Relaxed);
            }
            Command::CancelSleep => self.cancel_sleep(),
        }
    }

    fn load(&mut self, url: String, track: TrackInfo, start_position: f64) {
        self.uri = Some(url.clone());
        self.awaiting_advance = None;
        self.awaiting_wrap_hits = 0;
        self.clear_preload();
        self.cancel_sleep();
        self.fade_ramp = None;
        self.boundary_ticks = 0;
        self.fade_level = 1.0;
        self.teardown();

        let start = if start_position.is_finite() {
            start_position.max(0.0)
        } else {
            0.0
        };
        let duration = track.duration.map(|d| d as f64).unwrap_or(0.0);
        self.mutate(|snapshot| {
            snapshot.track = Some(track.clone());
            snapshot.position = start;
            snapshot.duration = duration;
            snapshot.status = PlaybackStatus::Playing;
            snapshot.buffering = true;
        });
        self.settle_until = Some(Instant::now() + POSITION_SETTLE);

        let _ = self.app.emit("hush://track", &track);
        self.mpris.set_metadata(&track);

        if !track.id.is_empty() {
            self.waveforms
                .analyze(self.app.clone(), track.id.clone(), url.clone());
        }

        match self.build(&url) {
            Ok(()) => self.start_playback(start, true),
            Err(err) => {
                self.fail(&err);
                return;
            }
        }

        self.emit_state();
        self.emit_position();
        self.update_discord();
    }

    fn preload(&mut self, url: String, track: TrackInfo) {
        if let Ok(mut next) = self.next.lock() {
            *next = Some((url, track));
        }
    }

    fn clear_preload(&mut self) {
        if let Ok(mut next) = self.next.lock() {
            *next = None;
        }
        if let Ok(mut pending) = self.pending_advance.lock() {
            *pending = None;
        }
    }

    fn has_next(&self) -> bool {
        self.next
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    fn take_next(&mut self) -> Option<(String, TrackInfo)> {
        self.next.lock().ok().and_then(|mut guard| guard.take())
    }

    fn build(&mut self, uri: &str) -> Result<(), String> {
        let playbin = gst::ElementFactory::make("playbin")
            .property("uri", uri)
            .build()
            .map_err(|err| element_error("playbin", err))?;

        // hush is audio-only: never let an embedded video/cover stream open
        // a window.
        let video_sink = gst::ElementFactory::make("fakesink")
            .property("sync", false)
            .property("async", false)
            .build()
            .map_err(|err| element_error("fakesink", err))?;
        playbin.set_property("video-sink", &video_sink);

        // Audio chain: rgvolume? → fade → volume → level?
        let chain = gst::Bin::new();

        let fade = gst::ElementFactory::make("volume")
            .property("volume", self.fade_level)
            .build()
            .map_err(|err| element_error("volume", err))?;
        let volume = gst::ElementFactory::make("volume")
            .property("volume", self.user_volume)
            .property("mute", self.muted)
            .build()
            .map_err(|err| element_error("volume", err))?;
        chain
            .add(&fade)
            .map_err(|e| e.to_string())?;
        chain
            .add(&volume)
            .map_err(|e| e.to_string())?;

        let mut rg_el = None;
        if self.rg_mode != ReplayGainMode::Off {
            let rg = gst::ElementFactory::make("rgvolume")
                .property("album-mode", self.rg_mode == ReplayGainMode::Album)
                .property("pre-amp", self.preamp)
                .build()
                .map_err(|err| element_error("rgvolume", err))?;
            chain.add(&rg).map_err(|e| e.to_string())?;
            rg_el = Some(rg);
        }

        let level = match gst::ElementFactory::make("level")
            .property("interval", 40_000_000u64)
            .build()
        {
            Ok(level) => {
                level.set_property("name", LEVEL_ELEMENT_NAME);
                chain.add(&level).map_err(|e| e.to_string())?;
                Some(level)
            }
            Err(err) => {
                eprintln!("[hush] level element unavailable: {err}");
                None
            }
        };

        let mut elements: Vec<gst::Element> = Vec::new();
        if let Some(rg) = &rg_el {
            elements.push(rg.clone());
        }
        elements.push(fade.clone());
        elements.push(volume.clone());
        if let Some(level) = &level {
            elements.push(level.clone());
        }
        for pair in elements.windows(2) {
            pair[0].link(&pair[1]).map_err(|e| e.to_string())?;
        }

        let first = elements.first().ok_or("empty audio chain")?;
        let last = elements.last().ok_or("empty audio chain")?;
        let sink_target = first
            .static_pad("sink")
            .ok_or_else(|| "audio chain has no sink pad".to_string())?;
        let src_target = last
            .static_pad("src")
            .ok_or_else(|| "audio chain has no src pad".to_string())?;
        let sink_ghost =
            gst::GhostPad::with_target(&sink_target).map_err(|e| e.to_string())?;
        let src_ghost = gst::GhostPad::with_target(&src_target).map_err(|e| e.to_string())?;
        chain
            .add_pad(&sink_ghost)
            .map_err(|e| e.to_string())?;
        chain.add_pad(&src_ghost).map_err(|e| e.to_string())?;
        playbin.set_property("audio-filter", &chain);

        // Gapless: swap the URI on `about-to-finish`. The streaming thread
        // only records the pair; the engine loop does the bookkeeping later.
        let playbin_for_signal = playbin.clone();
        let next_for_signal = self.next.clone();
        let pending_for_signal = self.pending_advance.clone();
        let gapless_for_signal = self.gapless_enabled.clone();
        let prevent_for_signal = self.prevent_advance.clone();
        let _ = playbin.connect("about-to-finish", false, move |_| {
            if prevent_for_signal.load(Ordering::Relaxed)
                || !gapless_for_signal.load(Ordering::Relaxed)
            {
                return None;
            }
            let pair = next_for_signal
                .lock()
                .ok()
                .and_then(|guard| guard.clone());
            if let Some((url, track)) = pair {
                playbin_for_signal.set_property("uri", url.as_str());
                if let Ok(mut pending) = pending_for_signal.lock() {
                    *pending = Some((url, track));
                }
            }
            None
        });

        let pipeline = gst::Pipeline::new();
        pipeline.add(&playbin).map_err(|e| e.to_string())?;

        self.pipeline = Some(pipeline);
        self.volume_el = Some(volume);
        self.fade_el = Some(fade);
        self.rg_el = rg_el;
        Ok(())
    }

    fn start_playback(&mut self, position: f64, play: bool) {
        let Some(pipeline) = self.pipeline.clone() else {
            return;
        };
        let _ = pipeline.set_state(gst::State::Paused);
        let _ = pipeline.state(gst::ClockTime::from_seconds(5));

        if position > 0.5 && position.is_finite() {
            let _ = pipeline.seek_simple(
                gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
                gst::ClockTime::from_seconds_f64(position),
            );
        }

        if play {
            let _ = pipeline.set_state(gst::State::Playing);
            self.mutate(|snapshot| snapshot.status = PlaybackStatus::Playing);
        } else {
            self.mutate(|snapshot| snapshot.status = PlaybackStatus::Paused);
        }

        self.mpris.set_status(self.snap().status);
        self.emit_state();
        self.emit_position();
    }

    fn play(&mut self) {
        if let Some(pipeline) = self.pipeline.clone() {
            self.restore_fade();
            let _ = pipeline.set_state(gst::State::Playing);
            self.mutate(|snapshot| snapshot.status = PlaybackStatus::Playing);
            self.emit_state();
            self.mpris.set_status(PlaybackStatus::Playing);
            self.update_discord();
        } else if let Some(uri) = self.uri.clone() {
            let position = self.snap().position;
            match self.build(&uri) {
                Ok(()) => {
                    self.start_playback(position, true);
                    self.update_discord();
                }
                Err(err) => self.fail(&err),
            }
        }
    }

    fn pause(&mut self) {
        self.pause_internal();
    }

    fn pause_internal(&mut self) {
        if let Some(pipeline) = self.pipeline.clone() {
            let _ = pipeline.set_state(gst::State::Paused);
            if let Some(position) = pipeline.query_position::<gst::ClockTime>() {
                let seconds = position.seconds_f64();
                self.mutate(|snapshot| snapshot.position = seconds);
            }
        }
        self.mutate(|snapshot| snapshot.status = PlaybackStatus::Paused);
        self.prevent_advance.store(false, Ordering::Relaxed);
        self.sleep_anchor = None;
        self.boundary_ticks = 0;
        self.emit_state();
        self.emit_position();
        self.mpris.set_status(PlaybackStatus::Paused);
        self.update_discord();
    }

    fn stop(&mut self) {
        self.awaiting_advance = None;
        self.awaiting_wrap_hits = 0;
        self.clear_preload();
        self.cancel_sleep();
        self.fade_ramp = None;
        self.boundary_ticks = 0;
        self.fade_level = 1.0;
        self.teardown();
        self.uri = None;
        self.mutate(|snapshot| {
            snapshot.status = PlaybackStatus::Stopped;
            snapshot.position = 0.0;
            snapshot.duration = 0.0;
            snapshot.track = None;
            snapshot.buffering = false;
        });
        self.emit_state();
        self.emit_position();
        self.mpris.set_status(PlaybackStatus::Stopped);
        self.mpris.clear_metadata();
        self.update_discord();
    }

    fn seek(&mut self, position: f64) {
        if !position.is_finite() {
            return;
        }
        // Seeking overrides a pending sleep/transition fade.
        self.cancel_sleep();
        if let Some(ramp) = self.fade_ramp {
            if ramp.goal != FadeGoal::FadeIn {
                self.fade_ramp = None;
                self.fade_level = 1.0;
            }
        }
        if self.fade_ramp.is_none() {
            if let Some(element) = self.fade_el.clone() {
                element.set_property("volume", 1.0);
            }
        }
        self.settle_until = None;
        self.boundary_ticks = 0;

        let duration = self.snap().duration;
        let target = if duration > 0.0 {
            position.clamp(0.0, duration)
        } else {
            position.max(0.0)
        };

        if let Some(pipeline) = self.pipeline.clone() {
            let _ = pipeline.seek_simple(
                gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
                gst::ClockTime::from_seconds_f64(target),
            );
            self.mutate(|snapshot| snapshot.position = target);
            self.emit_position();
            self.mpris.seeked(target);
            self.update_discord();
        }
    }

    fn set_volume(&mut self, volume: f64) {
        let volume = volume.clamp(0.0, 1.0);
        self.user_volume = volume;
        if let Some(element) = self.volume_el.clone() {
            element.set_property("volume", volume);
        }
        self.mutate(|snapshot| snapshot.volume = volume);
        self.emit_state();
        self.mpris.set_volume(volume);
    }

    fn set_mute(&mut self, muted: bool) {
        self.muted = muted;
        if let Some(element) = self.volume_el.clone() {
            element.set_property("mute", muted);
        }
        self.mutate(|snapshot| snapshot.muted = muted);
        self.emit_state();
    }

    fn set_replaygain(&mut self, mode: ReplayGainMode) {
        if mode == self.rg_mode {
            return;
        }

        let was_off = self.rg_mode == ReplayGainMode::Off;
        let now_off = mode == ReplayGainMode::Off;
        self.rg_mode = mode;
        self.mutate(|snapshot| snapshot.replaygain = mode);

        if was_off || now_off {
            // The gain stage must be added/removed, so rebuild while keeping
            // the current position and transport state.
            if let Some(uri) = self.uri.clone() {
                let snapshot = self.snap();
                self.awaiting_advance = None;
                self.awaiting_wrap_hits = 0;
                self.fade_ramp = None;
                self.teardown();
                if self.build(&uri).is_ok() {
                    let play = snapshot.status == PlaybackStatus::Playing;
                    self.start_playback(snapshot.position, play);
                }
            }
        } else if let Some(element) = self.rg_el.clone() {
            element.set_property("album-mode", mode == ReplayGainMode::Album);
        }

        self.last_gain = None;
        self.emit_state();
    }

    // ----- fades / boundaries ----------------------------------------------

    fn restore_fade(&mut self) {
        if self.fade_ramp.is_none() {
            self.fade_level = 1.0;
            if let Some(element) = self.fade_el.clone() {
                element.set_property("volume", 1.0);
            }
        }
    }

    fn start_fade(&mut self, to: f64, seconds: f64, goal: FadeGoal) {
        let duration = Duration::from_secs_f64(seconds.clamp(0.05, 60.0));
        self.fade_ramp = Some(FadeRamp {
            from: self.fade_level,
            to,
            started: Instant::now(),
            duration,
            goal,
        });
    }

    fn cancel_sleep(&mut self) {
        self.sleep_anchor = None;
        self.prevent_advance.store(false, Ordering::Relaxed);
        if let Some(ramp) = self.fade_ramp {
            if ramp.goal == FadeGoal::Pause {
                self.fade_ramp = None;
            }
        }
        if self.fade_ramp.is_none() {
            self.fade_level = 1.0;
            if let Some(element) = self.fade_el.clone() {
                element.set_property("volume", 1.0);
            }
        }
    }

    fn tick_fade(&mut self) {
        let Some(ramp) = self.fade_ramp else {
            return;
        };

        let elapsed = ramp.started.elapsed().as_secs_f64();
        let total = ramp.duration.as_secs_f64().max(0.001);
        let progress = (elapsed / total).clamp(0.0, 1.0);
        let level = ramp.from + (ramp.to - ramp.from) * progress;
        self.fade_level = level;
        if let Some(element) = self.fade_el.clone() {
            element.set_property("volume", level);
        }

        if progress < 1.0 {
            return;
        }

        self.fade_ramp = None;
        match ramp.goal {
            FadeGoal::Pause => self.pause_internal(),
            FadeGoal::Advance => {
                log_line("boundary: fade complete, rebuilding next track");
                if !self.advance_via_rebuild() {
                    self.restore_fade();
                }
            }
            FadeGoal::FadeIn | FadeGoal::None => {}
        }
    }

    fn tick_boundary(&mut self) {
        if self.fade_ramp.is_some() {
            self.boundary_ticks = 0;
            return;
        }
        let snapshot = self.snap();
        if snapshot.status != PlaybackStatus::Playing || snapshot.duration <= 0.0 {
            self.boundary_ticks = 0;
            return;
        }
        let remaining = snapshot.duration - snapshot.position;
        if !(remaining > 0.0) {
            self.boundary_ticks = 0;
            return;
        }

        let sleep_ready = self
            .sleep_anchor
            .map(|seconds| remaining <= seconds.max(0.3) + 0.2)
            .unwrap_or(false);
        let transition_ready = self.transition_mode == TransitionMode::Fade
            && self.has_next()
            && remaining <= self.fade_seconds + 0.2;

        if sleep_ready || transition_ready {
            self.boundary_ticks = self.boundary_ticks.saturating_add(1);
            if self.boundary_ticks < BOUNDARY_DEBOUNCE_TICKS {
                return;
            }
            self.boundary_ticks = 0;
            let seconds = remaining.max(0.3);
            if sleep_ready {
                self.sleep_anchor = None;
                self.prevent_advance.store(true, Ordering::Relaxed);
                log_line(&format!(
                    "boundary: sleep fade trigger remaining={remaining:.2}s"
                ));
                self.start_fade(0.0, seconds, FadeGoal::Pause);
            } else {
                log_line(&format!(
                    "boundary: fade transition trigger remaining={remaining:.2}s"
                ));
                self.start_fade(0.0, seconds, FadeGoal::Advance);
            }
        } else {
            self.boundary_ticks = 0;
        }
    }

    fn advance_via_rebuild(&mut self) -> bool {
        let Some((url, track)) = self.take_next() else {
            return false;
        };
        self.advance_to(url, track, true);
        true
    }

    fn advance_to(&mut self, url: String, track: TrackInfo, rebuild: bool) {
        self.uri = Some(url.clone());
        self.awaiting_advance = None;
        self.awaiting_wrap_hits = 0;
        self.fade_ramp = None;
        self.boundary_ticks = 0;

        let duration = track.duration.map(|d| d as f64).unwrap_or(0.0);
        self.mutate(|snapshot| {
            snapshot.track = Some(track.clone());
            snapshot.position = 0.0;
            snapshot.duration = duration;
            snapshot.status = PlaybackStatus::Playing;
            snapshot.buffering = rebuild;
        });

        if !track.id.is_empty() {
            self.waveforms
                .analyze(self.app.clone(), track.id.clone(), url.clone());
        }

        if rebuild {
            self.teardown();
            let fading = self.transition_mode == TransitionMode::Fade;
            self.fade_level = if fading { 0.0 } else { 1.0 };
            match self.build(&url) {
                Ok(()) => {
                    self.start_playback(0.0, true);
                    if fading {
                        self.start_fade(1.0, self.fade_seconds.max(0.5), FadeGoal::FadeIn);
                    }
                }
                Err(err) => {
                    self.fail(&err);
                    return;
                }
            }
        }
        self.settle_until = Some(Instant::now() + POSITION_SETTLE);

        let _ = self.app.emit("hush://track", &track);
        let _ = self.app.emit(
            "player://advanced",
            AdvancedEvent {
                track_id: track.id.clone(),
            },
        );
        self.mpris.set_metadata(&track);
        self.emit_state();
        self.emit_position();
        self.update_discord();
    }

    // ----- boundary detection ----------------------------------------------

    fn on_stream_start(&mut self) {
        let Some(pair) = self.awaiting_advance.clone() else {
            return;
        };
        let snapshot = self.snap();
        let remaining = (snapshot.duration - snapshot.position).max(0.0);
        if remaining > WRAP_WINDOW {
            // STREAM_START can be posted while the next item is being
            // prerolled; defer until the real end-of-track switch.
            log_line(&format!(
                "boundary: stream-start early (remaining={remaining:.1}s), deferring"
            ));
            return;
        }
        self.awaiting_advance = None;
        self.awaiting_wrap_hits = 0;
        log_line("boundary: stream-start advance");
        self.advance_to(pair.0, pair.1, false);
    }

    fn tick_awaiting_advance(&mut self) {
        let Some(pair) = self.awaiting_advance.clone() else {
            self.awaiting_wrap_hits = 0;
            return;
        };
        let snapshot = self.snap();
        if snapshot.status != PlaybackStatus::Playing {
            return;
        }

        let remaining = (snapshot.duration - snapshot.position).max(0.0);
        let near_end = remaining <= WRAP_WINDOW;
        let query = self
            .pipeline
            .as_ref()
            .and_then(|pipeline| pipeline.query_position::<gst::ClockTime>())
            .map(|position| position.seconds_f64());

        if near_end
            && snapshot.position > 0.5
            && query.map(|seconds| seconds < 0.5).unwrap_or(false)
        {
            self.awaiting_wrap_hits = self.awaiting_wrap_hits.saturating_add(1);
        } else {
            self.awaiting_wrap_hits = 0;
        }

        let wrapped = self.awaiting_wrap_hits >= 2;
        let expired = Instant::now() >= self.advance_deadline;
        if wrapped || expired {
            if expired && !wrapped {
                log_line(&format!(
                    "boundary: advance deadline fallback (remaining={remaining:.1}s)"
                ));
            } else {
                log_line("boundary: position-wrap advance");
            }
            self.awaiting_advance = None;
            self.awaiting_wrap_hits = 0;
            self.advance_to(pair.0, pair.1, false);
        }
    }

    // ----- bus / ticking ---------------------------------------------------

    fn poll_bus(&mut self) {
        let Some(pipeline) = self.pipeline.clone() else {
            return;
        };
        let Some(bus) = pipeline.bus() else {
            return;
        };

        let mut pending = Vec::new();
        while let Some(message) = bus.pop() {
            pending.push(message);
        }

        for message in pending {
            match message.view() {
                gst::MessageView::Eos(_) => self.on_eos(),
                gst::MessageView::StreamStart(_) => self.on_stream_start(),
                gst::MessageView::Error(error) => {
                    let detail = error.error().to_string();
                    let debug = error
                        .debug()
                        .map(|d| d.to_string())
                        .unwrap_or_default();
                    let text = if debug.is_empty() {
                        detail
                    } else {
                        format!("{detail} ({debug})")
                    };
                    self.fail(&text);
                }
                gst::MessageView::Warning(warning) => {
                    eprintln!("[hush] gstreamer warning: {}", warning.error());
                }
                gst::MessageView::Buffering(buffering) => {
                    let percent = buffering.percent();
                    let buffering_active = percent < 100;
                    self.mutate(|snapshot| snapshot.buffering = buffering_active);
                    if !buffering_active {
                        self.emit_state();
                    }
                }
                gst::MessageView::DurationChanged(_) | gst::MessageView::AsyncDone(_) => {
                    self.refresh_duration();
                }
                gst::MessageView::Element(element) => {
                    self.on_element_message(element);
                }
                _ => {}
            }
        }
    }

    fn on_element_message(&mut self, message: &gst::message::Element) {
        if !self.levels_enabled {
            return;
        }
        let Some(source) = message.src() else {
            return;
        };
        if source.name() != LEVEL_ELEMENT_NAME {
            return;
        }
        let Some(structure) = message.structure() else {
            return;
        };
        if structure.name() != "level" {
            return;
        }

        let peak = read_level_array(structure, "peak")
            .into_iter()
            .fold(0.0_f64, f64::max);
        let rms = read_level_array(structure, "rms")
            .into_iter()
            .fold(0.0_f64, f64::max);

        self.last_levels = Some((db_to_amplitude(peak, true), db_to_amplitude(rms, false)));
    }

    fn refresh_duration(&mut self) {
        if let Some(pipeline) = self.pipeline.clone() {
            if let Some(duration) = pipeline.query_duration::<gst::ClockTime>() {
                let seconds = duration.seconds_f64();
                if seconds.is_finite() && seconds > 0.0 {
                    self.mutate(|snapshot| snapshot.duration = seconds);
                    self.emit_state();
                }
            }
        }
    }

    fn tick(&mut self) {
        // Gapless swap recorded by the streaming thread.
        let pending = self.pending_advance.lock().ok().and_then(|mut guard| guard.take());
        if let Some((url, track)) = pending {
            let snapshot = self.snap();
            let remaining = (snapshot.duration - snapshot.position).max(0.0);
            self.advance_deadline = Instant::now()
                + Duration::from_secs_f64(remaining + ADVANCE_DEADLINE_MARGIN);
            self.awaiting_advance = Some((url, track));
            self.awaiting_wrap_hits = 0;
            log_line(&format!(
                "boundary: about-to-finish (remaining={remaining:.1}s)"
            ));
        }

        self.tick_awaiting_advance();
        self.tick_fade();
        self.tick_boundary();

        let snapshot = self.snap();
        let status = snapshot.status;

        if status == PlaybackStatus::Playing {
            // After an advance, reject the old track's tail position for a
            // short settle window (but let the new track's clock through).
            let settle_limit = self.settle_until.and_then(|until| {
                until
                    .checked_sub(POSITION_SETTLE)
                    .map(|advanced| advanced.elapsed().as_secs_f64() + 1.0)
            });
            if let Some(pipeline) = self.pipeline.clone() {
                if let Some(position) = pipeline.query_position::<gst::ClockTime>() {
                    let seconds = position.seconds_f64();
                    if seconds.is_finite() {
                        let value = seconds.max(0.0);
                        let plausible = settle_limit
                            .map(|limit| value <= limit)
                            .unwrap_or(true);
                        if plausible {
                            let clamped = if snapshot.duration > 0.0 {
                                value.clamp(0.0, snapshot.duration)
                            } else {
                                value
                            };
                            self.mutate(|state| state.position = clamped);
                        }
                    }
                }
            }

            if self.last_position_emit.elapsed() >= POSITION_INTERVAL {
                self.emit_position();
                self.last_position_emit = Instant::now();
            }

            if self.last_mpris_position.elapsed() >= MPRIS_POSITION_INTERVAL {
                self.mpris.set_position(self.snap().position);
                self.last_mpris_position = Instant::now();
            }

            if self.last_discord.elapsed() >= DISCORD_REFRESH {
                self.update_discord();
                self.last_discord = Instant::now();
            }

            self.emit_levels();
        }

        if self
            .settle_until
            .map(|until| Instant::now() >= until)
            .unwrap_or(false)
        {
            self.settle_until = None;
        }

        if let Some(element) = self.rg_el.clone() {
            let gain = element.property::<f64>("result-gain");
            let changed = self
                .last_gain
                .map(|previous| (previous - gain).abs() > 0.05)
                .unwrap_or(true);
            if changed {
                self.last_gain = Some(gain);
                let _ = self.app.emit(
                    "player://gain",
                    GainEvent {
                        applied: Some(gain),
                        mode: self.rg_mode,
                    },
                );
            }
        }
    }

    fn emit_levels(&mut self) {
        if !self.levels_enabled || self.last_level_emit.elapsed() < LEVELS_INTERVAL {
            return;
        }
        let Some((peak, rms)) = self.last_levels else {
            return;
        };
        self.last_level_emit = Instant::now();
        let _ = self.app.emit("player://levels", LevelsEvent { peak, rms });
    }

    fn on_eos(&mut self) {
        // A sleep fade may still be ramping when the stream ends; finish it as
        // a pause instead of advancing.
        let pausing = self.sleep_anchor.is_some()
            || matches!(self.fade_ramp.map(|ramp| ramp.goal), Some(FadeGoal::Pause));
        if pausing {
            self.sleep_anchor = None;
            self.fade_ramp = None;
            self.boundary_ticks = 0;
            self.fade_level = 0.0;
            if let Some(element) = self.fade_el.clone() {
                element.set_property("volume", 0.0);
            }
            log_line("boundary: eos during sleep fade, pausing");
            self.pause_internal();
            return;
        }

        // The gapless switch already happened in playbin: bookkeeping only.
        let pending = self.awaiting_advance.take().or_else(|| {
            self.pending_advance
                .lock()
                .ok()
                .and_then(|mut guard| guard.take())
        });
        if let Some((url, track)) = pending {
            self.awaiting_wrap_hits = 0;
            log_line("boundary: eos during gapless advance");
            self.advance_to(url, track, false);
            return;
        }

        // Fade mode: EOS arrived while (or before) the ramp finished.
        if matches!(self.fade_ramp.map(|ramp| ramp.goal), Some(FadeGoal::Advance)) {
            self.fade_ramp = None;
            log_line("boundary: eos during fade transition");
            if self.advance_via_rebuild() {
                return;
            }
        }

        // Nothing was preloaded: the queue (or repeat) is handled upstream.
        let duration = self.snap().duration;
        self.boundary_ticks = 0;
        self.mutate(|snapshot| {
            snapshot.status = PlaybackStatus::Stopped;
            snapshot.position = duration;
            snapshot.buffering = false;
        });
        self.emit_state();
        self.emit_position();
        log_line("boundary: eos without preload, emitting ended");
        let _ = self.app.emit("player://ended", ());
        self.mpris.set_status(PlaybackStatus::Stopped);
        self.update_discord();
    }

    fn fail(&mut self, message: &str) {
        self.awaiting_advance = None;
        self.awaiting_wrap_hits = 0;
        self.clear_preload();
        self.cancel_sleep();
        self.teardown();
        self.mutate(|snapshot| {
            snapshot.status = PlaybackStatus::Stopped;
            snapshot.buffering = false;
        });
        emit_error(&self.app, message);
        self.emit_state();
        self.mpris.set_status(PlaybackStatus::Stopped);
        self.update_discord();
    }

    fn update_discord(&mut self) {
        let snapshot = self.snap();
        if snapshot.status == PlaybackStatus::Playing {
            if let Some(track) = &snapshot.track {
                self.discord.set_presence(PresenceData {
                    title: track.title.clone(),
                    artist: track.artist.clone().unwrap_or_default(),
                    album: track.album.clone().unwrap_or_default(),
                    album_artist: track.album_artist.clone().unwrap_or_default(),
                    server: track
                        .server
                        .clone()
                        .unwrap_or_else(|| "Navidrome".to_string()),
                    format: track.format.clone().unwrap_or_default(),
                    bitrate: track.bit_rate,
                    cover_url: track.cover_url.clone(),
                    elapsed: snapshot.position.max(0.0) as u64,
                    duration: snapshot.duration.max(0.0) as u64,
                });
                return;
            }
        }
        self.discord.clear();
    }

    fn teardown(&mut self) {
        if let Some(pipeline) = self.pipeline.take() {
            let _ = pipeline.set_state(gst::State::Null);
        }
        self.volume_el = None;
        self.fade_el = None;
        self.rg_el = None;
        self.last_gain = None;
        self.last_levels = None;
        self.settle_until = None;
    }
}

fn read_level_array(structure: &gst::StructureRef, name: &str) -> Vec<f64> {
    structure
        .get::<glib::ValueArray>(name)
        .map(|array| {
            array
                .as_slice()
                .iter()
                .filter_map(|value| value.get::<f64>().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// `level` reports peak as a power ratio (10·log10) and RMS as amplitude
/// (20·log10). Convert both to a 0..1 linear value for the visualizer.
fn db_to_amplitude(db: f64, power: bool) -> f64 {
    if !db.is_finite() {
        return 0.0;
    }
    let divisor = if power { 10.0 } else { 20.0 };
    10_f64.powf(db / divisor).clamp(0.0, 1.0)
}
