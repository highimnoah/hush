use std::sync::{mpsc::Receiver, Arc, Mutex};
use std::time::{Duration, Instant};

use gstreamer as gst;
use gstreamer::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::config::ReplayGainMode;
use crate::discord::{DiscordHandle, PresenceData};
use crate::mpris::MprisHandle;
use crate::player::waveform::WaveformHandle;

use super::{Command, PlaybackStatus, PlayerSnapshot, TrackInfo};

const POSITION_INTERVAL: Duration = Duration::from_millis(300);
const MPRIS_POSITION_INTERVAL: Duration = Duration::from_millis(1000);
const DISCORD_REFRESH: Duration = Duration::from_secs(12);

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

struct Engine {
    app: AppHandle,
    snapshot: Arc<Mutex<PlayerSnapshot>>,
    discord: DiscordHandle,
    mpris: MprisHandle,
    waveforms: WaveformHandle,

    pipeline: Option<gst::Pipeline>,
    volume_el: Option<gst::Element>,
    rg_el: Option<gst::Element>,
    uri: Option<String>,

    rg_mode: ReplayGainMode,
    preamp: f64,
    user_volume: f64,
    muted: bool,

    last_position_emit: Instant,
    last_mpris_position: Instant,
    last_discord: Instant,
    last_gain: Option<f64>,
}

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
        rg_el: None,
        uri: None,
        rg_mode: replaygain,
        preamp,
        user_volume: volume.clamp(0.0, 1.0),
        muted,
        last_position_emit: Instant::now() - POSITION_INTERVAL,
        last_mpris_position: Instant::now() - MPRIS_POSITION_INTERVAL,
        last_discord: Instant::now() - DISCORD_REFRESH,
        last_gain: None,
    };

    engine.mpris.set_volume(engine.user_volume);
    engine.mpris.set_status(PlaybackStatus::Stopped);

    loop {
        match rx.recv_timeout(Duration::from_millis(120)) {
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
            Command::Load { url, track } => self.load(url, track),
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
        }
    }

    fn load(&mut self, url: String, track: TrackInfo) {
        self.uri = Some(url.clone());
        self.teardown();

        let duration = track.duration.map(|d| d as f64).unwrap_or(0.0);
        self.mutate(|snapshot| {
            snapshot.track = Some(track.clone());
            snapshot.position = 0.0;
            snapshot.duration = duration;
            snapshot.status = PlaybackStatus::Playing;
            snapshot.buffering = true;
        });

        let _ = self.app.emit("hush://track", &track);
        self.mpris.set_metadata(&track);

        if !track.id.is_empty() {
            self.waveforms
                .analyze(self.app.clone(), track.id.clone(), url.clone());
        }

        match self.build(&url) {
            Ok(()) => self.start_playback(0.0, true),
            Err(err) => {
                self.fail(&err);
                return;
            }
        }

        self.emit_state();
        self.emit_position();
        self.update_discord();
    }

    fn build(&mut self, uri: &str) -> Result<(), String> {
        let source = gst::ElementFactory::make("uridecodebin")
            .property("uri", uri)
            .build()
            .map_err(|err| element_error("uridecodebin", err))?;
        let queue = gst::ElementFactory::make("queue")
            .build()
            .map_err(|err| element_error("queue", err))?;
        let convert = gst::ElementFactory::make("audioconvert")
            .build()
            .map_err(|err| element_error("audioconvert", err))?;
        let resample = gst::ElementFactory::make("audioresample")
            .build()
            .map_err(|err| element_error("audioresample", err))?;
        let volume = gst::ElementFactory::make("volume")
            .property("volume", self.user_volume)
            .property("mute", self.muted)
            .build()
            .map_err(|err| element_error("volume", err))?;
        let sink = gst::ElementFactory::make("autoaudiosink")
            .build()
            .map_err(|err| element_error("autoaudiosink", err))?;

        let pipeline = gst::Pipeline::new();
        for element in [&source, &queue, &convert, &resample, &volume, &sink] {
            pipeline.add(element).map_err(|e| e.to_string())?;
        }

        let mut rg_el = None;
        if self.rg_mode != ReplayGainMode::Off {
            let rg = gst::ElementFactory::make("rgvolume")
                .property("album-mode", self.rg_mode == ReplayGainMode::Album)
                .property("pre-amp", self.preamp)
                .build()
                .map_err(|err| element_error("rgvolume", err))?;
            pipeline.add(&rg).map_err(|e| e.to_string())?;
            gst::Element::link_many([&queue, &convert, &resample, &rg, &volume, &sink])
            .map_err(|e| e.to_string())?;
            rg_el = Some(rg);
        } else {
            gst::Element::link_many([&queue, &convert, &resample, &volume, &sink])
                .map_err(|e| e.to_string())?;
        }

        let queue_for_pad = queue.clone();
        source.connect_pad_added(move |_source, pad| {
            if !pad_is_audio(&pad) {
                return;
            }
            if let Some(sink_pad) = queue_for_pad.static_pad("sink") {
                if !sink_pad.is_linked() {
                    let _ = pad.link(&sink_pad);
                }
            }
        });

        self.pipeline = Some(pipeline);
        self.volume_el = Some(volume);
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
        if let Some(pipeline) = self.pipeline.clone() {
            let _ = pipeline.set_state(gst::State::Paused);
            if let Some(position) = pipeline.query_position::<gst::ClockTime>() {
                let seconds = position.seconds_f64();
                self.mutate(|snapshot| snapshot.position = seconds);
            }
        }
        self.mutate(|snapshot| snapshot.status = PlaybackStatus::Paused);
        self.emit_state();
        self.emit_position();
        self.mpris.set_status(PlaybackStatus::Paused);
        self.update_discord();
    }

    fn stop(&mut self) {
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
                _ => {}
            }
        }
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
        let status = self.snap().status;

        if status == PlaybackStatus::Playing {
            if let Some(pipeline) = self.pipeline.clone() {
                if let Some(position) = pipeline.query_position::<gst::ClockTime>() {
                    let seconds = position.seconds_f64();
                    self.mutate(|snapshot| snapshot.position = seconds);
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

    fn on_eos(&mut self) {
        let duration = self.snap().duration;
        self.mutate(|snapshot| {
            snapshot.status = PlaybackStatus::Stopped;
            snapshot.position = duration;
            snapshot.buffering = false;
        });
        self.emit_state();
        self.emit_position();
        let _ = self.app.emit("player://ended", ());
        self.mpris.set_status(PlaybackStatus::Stopped);
        self.update_discord();
    }

    fn fail(&mut self, message: &str) {
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
        self.rg_el = None;
        self.last_gain = None;
    }
}

fn pad_is_audio(pad: &gst::Pad) -> bool {
    if let Some(caps) = pad.current_caps() {
        if caps_is_audio(&caps) {
            return true;
        }
    }
    let caps = pad.query_caps(None);
    caps_is_audio(&caps)
}

fn caps_is_audio(caps: &gst::Caps) -> bool {
    caps.iter().any(|structure| structure.name().starts_with("audio/"))
}
