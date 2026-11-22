use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use gstreamer as gst;
use gstreamer::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const OUT_BUCKETS: usize = 240;
const RES_PER_SEC: f64 = 20.0;
const ANALYSIS_RATE: u32 = 4000;
const MAX_CACHE: usize = 64;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformEvent {
    pub track_id: String,
    pub peaks: Vec<f32>,
}

/// Computes and caches waveform peak data for tracks. Analysis runs on a
/// background thread using a separate GStreamer pipeline that decodes to a
/// low-rate mono signal, so it stays cheap and never blocks playback.
#[derive(Clone)]
pub struct WaveformHandle {
    cache: Arc<Mutex<HashMap<String, Vec<f32>>>>,
    inflight: Arc<Mutex<Option<String>>>,
}

impl WaveformHandle {
    pub fn new() -> Self {
        Self {
            cache: Arc::new(Mutex::new(HashMap::new())),
            inflight: Arc::new(Mutex::new(None)),
        }
    }

    pub fn get(&self, track_id: &str) -> Option<Vec<f32>> {
        self.cache
            .lock()
            .ok()
            .and_then(|cache| cache.get(track_id).cloned())
    }

    pub fn analyze(&self, app: AppHandle, track_id: String, url: String) {
        if let Some(peaks) = self.get(&track_id) {
            let _ = app.emit(
                "hush://waveform",
                WaveformEvent {
                    track_id,
                    peaks,
                },
            );
            return;
        }

        {
            let Ok(mut inflight) = self.inflight.lock() else {
                return;
            };
            if inflight.as_deref() == Some(track_id.as_str()) {
                return;
            }
            *inflight = Some(track_id.clone());
        }

        let cache = self.cache.clone();
        let inflight = self.inflight.clone();

        let _ = std::thread::Builder::new()
            .name("hush-waveform".to_string())
            .spawn(move || {
                if gst::init().is_err() {
                    clear_inflight(&inflight, &track_id);
                    return;
                }

                match compute_peaks(&url, &track_id, &inflight) {
                    Ok(peaks) => {
                        let current = inflight
                            .lock()
                            .map(|guard| guard.as_deref() == Some(track_id.as_str()))
                            .unwrap_or(false);
                        if !current {
                            return;
                        }
                        if let Ok(mut cache) = cache.lock() {
                            if cache.len() >= MAX_CACHE {
                                if let Some(key) = cache.keys().next().cloned() {
                                    cache.remove(&key);
                                }
                            }
                            cache.insert(track_id.clone(), peaks.clone());
                        }
                        let _ = app.emit(
                            "hush://waveform",
                            WaveformEvent {
                                track_id: track_id.clone(),
                                peaks,
                            },
                        );
                        clear_inflight(&inflight, &track_id);
                    }
                    Err(err) => {
                        if err != "cancelled" {
                            eprintln!("[hush] waveform analysis failed: {err}");
                        }
                        clear_inflight(&inflight, &track_id);
                    }
                }
            });
    }
}

fn clear_inflight(inflight: &Arc<Mutex<Option<String>>>, track_id: &str) {
    if let Ok(mut guard) = inflight.lock() {
        if guard.as_deref() == Some(track_id) {
            *guard = None;
        }
    }
}

struct Accumulator {
    rate: f64,
    buckets: Vec<f32>,
    samples: u64,
}

impl Accumulator {
    fn new(rate: f64) -> Self {
        Self {
            rate,
            buckets: Vec::new(),
            samples: 0,
        }
    }

    fn push(&mut self, data: &[u8]) {
        for chunk in data.chunks_exact(2) {
            let raw = i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0;
            let index = (self.samples as f64 / self.rate * RES_PER_SEC) as usize;
            if index >= self.buckets.len() {
                self.buckets.resize(index + 1, 0.0);
            }
            let magnitude = raw.abs();
            if magnitude > self.buckets[index] {
                self.buckets[index] = magnitude;
            }
            self.samples += 1;
        }
    }

    fn finish(&self) -> Vec<f32> {
        if self.buckets.is_empty() {
            return vec![0.0; OUT_BUCKETS];
        }

        let len = self.buckets.len();
        let mut output = vec![0.0f32; OUT_BUCKETS];

        for (index, slot) in output.iter_mut().enumerate() {
            let start = index * len / OUT_BUCKETS;
            let end = (((index + 1) * len / OUT_BUCKETS).max(start + 1)).min(len);
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

        // Scale against a high percentile rather than the absolute maximum, so
        // a single loud transient cannot squash the rest of the track. No gamma
        // curve is applied: quiet and loud sections must stay distinguishable.
        let mut sorted = output.clone();
        sorted.sort_by(|a, b| {
            a.partial_cmp(b)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let reference_index =
            ((sorted.len().saturating_sub(1)) as f32 * 0.95).round() as usize;
        let reference = sorted
            .get(reference_index)
            .copied()
            .unwrap_or(0.0)
            .max(0.02);

        let scale = 1.0 / reference;
        for value in &mut output {
            *value = (*value * scale).clamp(0.0, 1.0);
        }

        output
    }
}

fn compute_peaks(
    url: &str,
    track_id: &str,
    inflight: &Arc<Mutex<Option<String>>>,
) -> Result<Vec<f32>, String> {
    let source = gst::ElementFactory::make("uridecodebin")
        .property("uri", url)
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

    let accumulator = Arc::new(Mutex::new(Accumulator::new(ANALYSIS_RATE as f64)));
    let accumulator_for_probe = accumulator.clone();

    let Some(source_pad) = filter.static_pad("src") else {
        return Err("capsfilter has no source pad".to_string());
    };
    source_pad.add_probe(gst::PadProbeType::BUFFER, move |_pad, info| {
        if let Some(buffer) = info.buffer() {
            if let Ok(map) = buffer.map_readable() {
                if let Ok(mut guard) = accumulator_for_probe.lock() {
                    guard.push(map.as_slice());
                }
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
    let deadline = Instant::now() + Duration::from_secs(90);

    let outcome = loop {
        if Instant::now() > deadline {
            break Err("waveform analysis timed out".to_string());
        }

        let cancelled = inflight
            .lock()
            .map(|guard| guard.as_deref() != Some(track_id))
            .unwrap_or(true);
        if cancelled {
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

    outcome?;
    let peaks = accumulator
        .lock()
        .map(|guard| guard.finish())
        .map_err(|_| "waveform accumulator poisoned".to_string())?;
    Ok(peaks)
}

fn caps_is_audio_pad(pad: &gst::Pad) -> bool {
    if let Some(caps) = pad.current_caps() {
        if caps.iter().any(|structure| structure.name().starts_with("audio/")) {
            return true;
        }
    }
    let caps = pad.query_caps(None);
    caps.iter()
        .any(|structure| structure.name().starts_with("audio/"))
}
