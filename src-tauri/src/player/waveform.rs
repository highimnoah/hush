use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use gstreamer as gst;
use gstreamer::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Number of bars the UI renders. The backend sends a prefix of this array,
/// so a partially analysed track fills in from the left.
pub const OUT_BUCKETS: usize = 240;
/// Peak buckets per second of audio. 50 ms resolution is plenty for a seek bar.
const RES_PER_SEC: f64 = 20.0;
const ANALYSIS_RATE: u32 = 4000;
/// Tracks kept on disk. 240 f32 per track is roughly 1 KB, so this is a few MB.
const MAX_ENTRIES: usize = 2000;
/// Simultaneous in-progress bucket buffers (usually one or two).
const MAX_BUILDERS: usize = 8;
const MAX_QUEUE: usize = 6;
const EMIT_INTERVAL: Duration = Duration::from_millis(400);
const SAVE_INTERVAL: Duration = Duration::from_millis(2500);
/// Let playback start buffering before the analyser opens a second stream.
const ANALYZE_STAGGER: Duration = Duration::from_millis(1500);
const ANALYSIS_TIMEOUT: Duration = Duration::from_secs(120);

/// Peak data for one track. `peaks` is a prefix of the 240 UI slots; if
/// `complete` is false the rest has not been analysed yet.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformData {
    #[serde(default)]
    pub peaks: Vec<f32>,
    #[serde(default)]
    pub complete: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformEvent {
    pub track_id: String,
    pub peaks: Vec<f32>,
    pub complete: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct WaveformFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    tracks: HashMap<String, WaveformData>,
}

#[derive(Clone)]
struct Playing {
    id: String,
    duration: f64,
}

struct Entry {
    data: WaveformData,
    lru: u64,
}

#[derive(Default)]
struct Inner {
    entries: HashMap<String, Entry>,
    builders: HashMap<String, Builder>,
    playing: Option<Playing>,
    seq: u64,
}

impl Inner {
    fn builder(&mut self, track_id: &str, duration: f64) -> &mut Builder {
        if !self.builders.contains_key(track_id) {
            if self.builders.len() >= MAX_BUILDERS {
                let victim = self
                    .builders
                    .iter()
                    .filter(|(id, _)| {
                        self.playing
                            .as_ref()
                            .map(|playing| &playing.id != *id)
                            .unwrap_or(true)
                    })
                    .min_by_key(|(_, builder)| builder.last_touch)
                    .map(|(id, _)| id.clone());
                if let Some(id) = victim {
                    self.builders.remove(&id);
                }
            }
            self.builders
                .insert(track_id.to_string(), Builder::new(duration));
        }
        let builder = self.builders.get_mut(track_id).expect("builder exists");
        if duration > 0.0 && builder.duration <= 0.0 {
            builder.duration = duration;
        }
        builder
    }
}

struct Request {
    track_id: String,
    url: String,
    duration: f64,
    delay: Duration,
    urgent: bool,
}

struct Queue {
    items: Mutex<VecDeque<Request>>,
    signal: Condvar,
}

/// Shared waveform store. Two sources feed it:
///
/// * the playthrough probe taps the playback pipeline (zero extra bandwidth),
/// * a background analysis pipeline decodes the file as fast as it can.
///
/// Both write into the same 50 ms bucket buffer per track. The reduced 240-bar
/// prefix is emitted progressively and persisted to disk.
#[derive(Clone)]
pub struct WaveformHandle {
    app: AppHandle,
    path: Arc<PathBuf>,
    inner: Arc<Mutex<Inner>>,
    queue: Arc<Queue>,
    save_dirty: Arc<AtomicBool>,
}

impl WaveformHandle {
    pub fn new(app: AppHandle, path: PathBuf) -> Self {
        let file = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<WaveformFile>(&raw).ok())
            .unwrap_or_default();

        let mut inner = Inner::default();
        for (id, mut data) in file.tracks {
            data.peaks.truncate(OUT_BUCKETS);
            for peak in &mut data.peaks {
                *peak = peak.clamp(0.0, 1.0);
            }
            if data.peaks.is_empty() {
                continue;
            }
            inner.seq += 1;
            let lru = inner.seq;
            inner.entries.insert(id, Entry { data, lru });
        }
        while inner.entries.len() > MAX_ENTRIES {
            let oldest = inner
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.lru)
                .map(|(id, _)| id.clone());
            match oldest {
                Some(id) => {
                    inner.entries.remove(&id);
                }
                None => break,
            }
        }

        let handle = Self {
            app,
            path: Arc::new(path),
            inner: Arc::new(Mutex::new(inner)),
            queue: Arc::new(Queue {
                items: Mutex::new(VecDeque::new()),
                signal: Condvar::new(),
            }),
            save_dirty: Arc::new(AtomicBool::new(false)),
        };
        handle.spawn_saver();
        handle.spawn_worker();
        handle
    }

    /// Current reduced data, including in-progress prefixes.
    pub fn get(&self, track_id: &str) -> Option<WaveformData> {
        if track_id.is_empty() {
            return None;
        }
        let Ok(mut inner) = self.inner.lock() else {
            return None;
        };
        let builder = inner
            .builders
            .get(track_id)
            .map(|builder| builder.data())
            .filter(|data| !data.peaks.is_empty());
        inner.seq += 1;
        let seq = inner.seq;
        match inner.entries.get_mut(track_id) {
            Some(entry) => {
                entry.lru = seq;
                if let Some(builder) = builder {
                    if builder.complete || builder.peaks.len() > entry.data.peaks.len() {
                        return Some(WaveformData {
                            peaks: builder.peaks,
                            complete: builder.complete || entry.data.complete,
                        });
                    }
                }
                Some(entry.data.clone())
            }
            None => builder,
        }
    }

    /// Tells the store which track is actually playing so the playthrough
    /// probe can attribute buffers. Called on load/advance/stop.
    pub fn playing_changed(&self, track_id: Option<&str>, duration: f64) {
        let mut finished: Option<(String, WaveformData)> = None;
        {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            if let Some(previous) = inner.playing.take() {
                if Some(previous.id.as_str()) != track_id {
                    if let Some(builder) = inner.builders.remove(&previous.id) {
                        let data = builder.data();
                        if !data.peaks.is_empty() {
                            finished = Some((previous.id, data));
                        }
                    }
                }
            }
            if let Some(id) = track_id.filter(|id| !id.is_empty()) {
                let complete = inner
                    .entries
                    .get(id)
                    .map(|entry| entry.data.complete)
                    .unwrap_or(false);
                if !complete {
                    inner.builder(id, duration);
                }
                inner.playing = Some(Playing {
                    id: id.to_string(),
                    duration,
                });
            }
        }
        if let Some((id, data)) = finished {
            self.store(&id, data.clone());
            self.emit(&id, &data);
        }
    }

    /// Metadata duration can arrive after the track starts (async preroll).
    pub fn set_duration(&self, duration: f64) {
        if !(duration.is_finite() && duration > 0.0) {
            return;
        }
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        let Some(playing) = inner.playing.as_mut() else {
            return;
        };
        if (playing.duration - duration).abs() < 0.5 {
            return;
        }
        playing.duration = duration;
        let id = playing.id.clone();
        if let Some(builder) = inner.builders.get_mut(&id) {
            builder.duration = duration;
        }
    }

    /// Feed decoded playback audio (4 kHz mono S16LE) at the given PTS.
    pub fn feed_playback(&self, pts: Option<f64>, data: &[u8]) {
        let mut snapshot = None;
        let mut completed = None;
        let id;
        {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            let Some(playing) = inner.playing.clone() else {
                return;
            };
            if inner
                .entries
                .get(&playing.id)
                .map(|entry| entry.data.complete)
                .unwrap_or(false)
            {
                return;
            }
            id = playing.id.clone();
            let duration = playing.duration;
            {
                let builder = inner.builder(&id, duration);
                let start = builder.valid_start(pts);
                builder.push(start, data, ANALYSIS_RATE as f64);
                builder.cursor = start + data.len() as f64 / 2.0 / ANALYSIS_RATE as f64;
                if builder.complete || builder.last_emit.elapsed() >= EMIT_INTERVAL {
                    builder.last_emit = Instant::now();
                    if builder.complete {
                        completed = Some(builder.data());
                    } else {
                        snapshot = Some(builder.data());
                    }
                }
            }
            if completed.is_some() {
                inner.builders.remove(&id);
            }
        }
        if let Some(data) = completed {
            self.store(&id, data.clone());
            self.emit(&id, &data);
        } else if let Some(data) = snapshot {
            self.emit(&id, &data);
        }
    }

    /// Queue the current track for fast full-file analysis. The delay lets
    /// initial playback buffering win the first couple of seconds.
    pub fn analyze_current(&self, track_id: String, url: String, duration: f64) {
        self.enqueue(track_id, url, duration, ANALYZE_STAGGER, false, true);
    }

    /// Queue the next (gapless) track as soon as it is preloaded.
    pub fn prewarm(&self, track_id: String, url: String, duration: f64) {
        self.enqueue(track_id, url, duration, Duration::ZERO, false, false);
    }

    /// On-demand analysis for views that show a track that is not playing
    /// (for example the lyrics editor). Returns cached data if it is complete.
    pub fn ensure(&self, track_id: String, url: String, duration: f64) -> Option<WaveformData> {
        if let Some(data) = self.get(&track_id) {
            if data.complete && !data.peaks.is_empty() {
                return Some(data);
            }
        }
        self.enqueue(track_id, url, duration, Duration::ZERO, true, false);
        None
    }

    fn enqueue(
        &self,
        track_id: String,
        url: String,
        duration: f64,
        delay: Duration,
        urgent: bool,
        drop_stale: bool,
    ) {
        if track_id.is_empty() || url.is_empty() {
            return;
        }
        if self
            .get(&track_id)
            .map(|data| data.complete)
            .unwrap_or(false)
        {
            return;
        }
        let Ok(mut items) = self.queue.items.lock() else {
            return;
        };
        // A new current track makes queued analyses of skipped tracks useless.
        if drop_stale {
            items.retain(|queued| queued.urgent || queued.track_id == track_id);
        }
        if items.iter().any(|request| request.track_id == track_id) {
            return;
        }
        let request = Request {
            track_id,
            url,
            duration,
            delay,
            urgent,
        };
        if urgent {
            items.retain(|queued| !queued.urgent);
            items.push_front(request);
        } else {
            if items.len() >= MAX_QUEUE {
                items.pop_back();
            }
            items.push_back(request);
        }
        self.queue.signal.notify_one();
    }

    fn store(&self, track_id: &str, data: WaveformData) {
        if data.peaks.is_empty() {
            return;
        }
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        if let Some(existing) = inner.entries.get(track_id) {
            if existing.data.complete && !data.complete {
                return;
            }
        }
        inner.seq += 1;
        let lru = inner.seq;
        inner
            .entries
            .insert(track_id.to_string(), Entry { data, lru });
        while inner.entries.len() > MAX_ENTRIES {
            let oldest = inner
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.lru)
                .map(|(id, _)| id.clone());
            match oldest {
                Some(id) => {
                    inner.entries.remove(&id);
                }
                None => break,
            }
        }
        self.save_dirty.store(true, Ordering::Relaxed);
    }

    fn emit(&self, track_id: &str, data: &WaveformData) {
        let _ = self.app.emit(
            "hush://waveform",
            WaveformEvent {
                track_id: track_id.to_string(),
                peaks: data.peaks.clone(),
                complete: data.complete,
            },
        );
    }

    fn spawn_saver(&self) {
        let this = self.clone();
        let _ = std::thread::Builder::new()
            .name("hush-waveform-save".to_string())
            .spawn(move || loop {
                std::thread::sleep(SAVE_INTERVAL);
                if !this.save_dirty.swap(false, Ordering::Relaxed) {
                    continue;
                }
                if let Err(err) = this.save() {
                    eprintln!("[hush] could not save waveforms: {err}");
                    this.save_dirty.store(true, Ordering::Relaxed);
                }
            });
    }

    fn save(&self) -> std::io::Result<()> {
        let tracks = {
            let Ok(inner) = self.inner.lock() else {
                return Ok(());
            };
            inner
                .entries
                .iter()
                .map(|(id, entry)| (id.clone(), entry.data.clone()))
                .collect::<HashMap<_, _>>()
        };
        if tracks.is_empty() {
            return Ok(());
        }
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = WaveformFile { version: 1, tracks };
        let json = serde_json::to_string(&file)?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(&tmp, &*self.path)?;
        Ok(())
    }

    fn spawn_worker(&self) {
        let this = self.clone();
        let _ = std::thread::Builder::new()
            .name("hush-waveform-analyze".to_string())
            .spawn(move || loop {
                let request = {
                    let Ok(mut items) = this.queue.items.lock() else {
                        return;
                    };
                    while items.is_empty() {
                        match this.queue.signal.wait(items) {
                            Ok(guard) => items = guard,
                            Err(_) => return,
                        }
                    }
                    match items.pop_front() {
                        Some(request) => request,
                        None => continue,
                    }
                };

                if this
                    .get(&request.track_id)
                    .map(|data| data.complete)
                    .unwrap_or(false)
                {
                    continue;
                }
                if !request.delay.is_zero() {
                    std::thread::sleep(request.delay);
                }
                if this
                    .get(&request.track_id)
                    .map(|data| data.complete)
                    .unwrap_or(false)
                {
                    continue;
                }

                match this.run_analysis(&request) {
                    Ok(()) => this.finish_analysis(&request.track_id, true),
                    Err(err) => {
                        if err != "cancelled" {
                            eprintln!("[hush] waveform analysis failed: {err}");
                        }
                        this.finish_analysis(&request.track_id, false);
                    }
                }
            });
    }

    fn feed_analysis(&self, track_id: &str, pts: Option<f64>, data: &[u8]) {
        let mut snapshot = None;
        {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            let Some(builder) = inner.builders.get_mut(track_id) else {
                return;
            };
            let start = builder.valid_start(pts);
            builder.push(start, data, ANALYSIS_RATE as f64);
            builder.cursor = start + data.len() as f64 / 2.0 / ANALYSIS_RATE as f64;
            if builder.last_emit.elapsed() >= EMIT_INTERVAL {
                builder.last_emit = Instant::now();
                snapshot = Some(builder.data());
            }
        }
        if let Some(data) = snapshot {
            self.emit(track_id, &data);
        }
    }

    fn finish_analysis(&self, track_id: &str, complete: bool) {
        let data = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            inner.builders.remove(track_id).map(|mut builder| {
                if complete {
                    builder.complete = true;
                }
                builder.data()
            })
        };
        if let Some(data) = data {
            if !data.peaks.is_empty() {
                self.store(track_id, data.clone());
                self.emit(track_id, &data);
            }
        }
    }

    fn run_analysis(&self, request: &Request) -> Result<(), String> {
        if gst::init().is_err() {
            return Err("could not initialise GStreamer".to_string());
        }
        {
            let Ok(mut inner) = self.inner.lock() else {
                return Err("waveform store unavailable".to_string());
            };
            inner.builder(&request.track_id, request.duration);
        }

        let source = gst::ElementFactory::make("uridecodebin")
            .property("uri", request.url.as_str())
            .build()
            .map_err(|err| err.to_string())?;
        let convert = gst::ElementFactory::make("audioconvert")
            .build()
            .map_err(|err| err.to_string())?;
        let resample = gst::ElementFactory::make("audioresample")
            .build()
            .map_err(|err| err.to_string())?;

        let caps = gst::Caps::builder("audio/x-raw")
            .field("format", "S16LE")
            .field("channels", 1i32)
            .field("rate", ANALYSIS_RATE as i32)
            .build();
        let filter = gst::ElementFactory::make("capsfilter")
            .property("caps", caps)
            .build()
            .map_err(|err| err.to_string())?;

        let sink = gst::ElementFactory::make("fakesink")
            .property("sync", false)
            .property("async", false)
            .build()
            .map_err(|err| err.to_string())?;

        let pipeline = gst::Pipeline::new();
        for element in [&source, &convert, &resample, &filter, &sink] {
            pipeline.add(element).map_err(|err| err.to_string())?;
        }
        gst::Element::link_many([&convert, &resample, &filter, &sink])
            .map_err(|err| err.to_string())?;

        let convert_for_pad = convert.clone();
        source.connect_pad_added(move |_source, pad| {
            if !caps_is_audio_pad(pad) {
                return;
            }
            if let Some(sink_pad) = convert_for_pad.static_pad("sink") {
                if !sink_pad.is_linked() {
                    let _ = pad.link(&sink_pad);
                }
            }
        });

        let handle = self.clone();
        let track_id = request.track_id.clone();
        let Some(source_pad) = filter.static_pad("src") else {
            return Err("capsfilter has no source pad".to_string());
        };
        source_pad.add_probe(gst::PadProbeType::BUFFER, move |_pad, info| {
            if let Some(buffer) = info.buffer() {
                let pts = buffer.pts().map(|time| time.seconds_f64());
                if let Ok(map) = buffer.map_readable() {
                    handle.feed_analysis(&track_id, pts, map.as_slice());
                }
            }
            gst::PadProbeReturn::Ok
        });

        pipeline
            .set_state(gst::State::Playing)
            .map_err(|err| err.to_string())?;
        let bus = pipeline
            .bus()
            .ok_or_else(|| "pipeline has no bus".to_string())?;
        let deadline = Instant::now() + ANALYSIS_TIMEOUT;

        let outcome = loop {
            if Instant::now() > deadline {
                break Err("waveform analysis timed out".to_string());
            }
            // The track was switched away from; stop downloading its audio.
            let active = self
                .inner
                .lock()
                .map(|inner| inner.builders.contains_key(&request.track_id))
                .unwrap_or(false);
            if !active {
                break Err("cancelled".to_string());
            }
            if let Some(message) = bus.timed_pop(gst::ClockTime::from_mseconds(120)) {
                match message.view() {
                    gst::MessageView::Eos(_) => break Ok(()),
                    gst::MessageView::Error(error) => {
                        let detail = error.error().to_string();
                        let debug = error.debug().map(|d| d.to_string()).unwrap_or_default();
                        break Err(if debug.is_empty() {
                            detail
                        } else {
                            format!("{detail} ({debug})")
                        });
                    }
                    _ => {}
                }
            }
        };

        let _ = pipeline.set_state(gst::State::Null);
        outcome
    }
}

struct Builder {
    buckets: Vec<f32>,
    known: Vec<bool>,
    duration: f64,
    complete: bool,
    last_emit: Instant,
    last_touch: Instant,
    /// Fallback timeline when buffers carry no PTS.
    cursor: f64,
}

impl Builder {
    fn new(duration: f64) -> Self {
        Self {
            buckets: Vec::new(),
            known: Vec::new(),
            duration: duration.max(0.0),
            complete: false,
            last_emit: Instant::now() - EMIT_INTERVAL,
            last_touch: Instant::now(),
            cursor: 0.0,
        }
    }

    /// Ignore absurd/missing PTS values instead of allocating gigabytes.
    fn valid_start(&self, pts: Option<f64>) -> f64 {
        let limit = if self.duration > 1.0 {
            self.duration + 30.0
        } else {
            3.0 * 3600.0
        };
        match pts {
            Some(value) if value.is_finite() && value >= 0.0 && value <= limit => value,
            _ => self.cursor,
        }
    }

    fn push(&mut self, start: f64, data: &[u8], rate: f64) {
        if rate <= 0.0 {
            return;
        }
        self.last_touch = Instant::now();
        let base = (start.max(0.0) * RES_PER_SEC).floor() as usize;
        for (index, chunk) in data.chunks_exact(2).enumerate() {
            let offset = (index as f64 / rate * RES_PER_SEC) as usize;
            let bucket = base + offset;
            let value = i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0;
            let magnitude = value.abs();
            if self.buckets.len() <= bucket {
                self.buckets.resize(bucket + 1, 0.0);
                self.known.resize(bucket + 1, false);
            }
            if magnitude > self.buckets[bucket] {
                self.buckets[bucket] = magnitude;
            }
            self.known[bucket] = true;
        }

        // If playback alone has covered the whole track, mark it done so the
        // data is persisted even when the fast analyser failed.
        if !self.complete && self.duration > 1.0 {
            let covered = self.contiguous_known() as f64 / RES_PER_SEC;
            if covered >= self.duration - 0.5 {
                self.complete = true;
            }
        }
    }

    fn contiguous_known(&self) -> usize {
        self.known.iter().take_while(|known| **known).count()
    }

    fn data(&self) -> WaveformData {
        let span = self.buckets.len() as f64 / RES_PER_SEC;
        let duration = if self.complete && span > 1.0 {
            span
        } else if self.duration > 0.5 {
            self.duration
        } else {
            span
        };
        if self.buckets.is_empty() || duration <= 0.0 {
            return WaveformData::default();
        }

        let covered = if self.complete {
            duration
        } else {
            let known = self.contiguous_known() as f64 / RES_PER_SEC;
            known.min(duration)
        };
        let slots = if self.complete {
            OUT_BUCKETS
        } else {
            ((covered / duration) * OUT_BUCKETS as f64).floor() as usize
        }
        .min(OUT_BUCKETS);
        if slots == 0 {
            return WaveformData {
                peaks: Vec::new(),
                complete: false,
            };
        }

        let mut output = vec![0.0f32; slots];
        for (index, slot) in output.iter_mut().enumerate() {
            let start =
                ((index as f64 / OUT_BUCKETS as f64) * duration * RES_PER_SEC).floor() as usize;
            let end = ((((index + 1) as f64 / OUT_BUCKETS as f64) * duration * RES_PER_SEC).ceil()
                as usize)
                .max(start + 1)
                .min(self.buckets.len());
            if start >= end {
                continue;
            }
            let count = (end - start) as f32;
            let mut sum = 0.0f32;
            let mut peak = 0.0f32;
            for &value in &self.buckets[start..end] {
                sum += value;
                if value > peak {
                    peak = value;
                }
            }
            let mean = sum / count;
            // Blend peak with mean so transients stay visible while sustained
            // sections keep their own level instead of every window peaking.
            *slot = peak * 0.4 + mean * 0.6;
        }

        normalize(&mut output);
        WaveformData {
            peaks: output,
            complete: self.complete,
        }
    }
}

/// Scale against a high percentile rather than the absolute maximum, so a
/// single loud transient cannot squash the rest of the track.
fn normalize(output: &mut [f32]) {
    let mut sorted = output.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let reference_index = ((sorted.len().saturating_sub(1)) as f32 * 0.95).round() as usize;
    let reference = sorted
        .get(reference_index)
        .copied()
        .unwrap_or(0.0)
        .max(0.02);
    let scale = 1.0 / reference;
    for value in output.iter_mut() {
        *value = (*value * scale).clamp(0.0, 1.0);
    }
}

fn caps_is_audio_pad(pad: &gst::Pad) -> bool {
    if let Some(caps) = pad.current_caps() {
        if caps
            .iter()
            .any(|structure| structure.name().starts_with("audio/"))
        {
            return true;
        }
    }
    let caps = pad.query_caps(None);
    caps.iter()
        .any(|structure| structure.name().starts_with("audio/"))
}
