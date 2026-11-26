pub mod engine;
pub mod waveform;

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use self::waveform::WaveformHandle;
use crate::config::{ReplayGainMode, TransitionMode};
use crate::discord::DiscordHandle;
use crate::mpris::MprisHandle;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    #[default]
    Stopped,
    Playing,
    Paused,
}

/// Metadata for the currently loaded track. The frontend supplies most fields;
/// Rust enriches it with a resolved cover URL and server display name.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub artist_id: Option<String>,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub album_id: Option<String>,
    #[serde(default)]
    pub album_artist: Option<String>,
    #[serde(default)]
    pub cover_art: Option<String>,
    #[serde(default)]
    pub cover_url: Option<String>,
    #[serde(default)]
    pub server: Option<String>,
    #[serde(default)]
    pub duration: Option<u32>,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub bit_rate: Option<u32>,
    #[serde(default)]
    pub bit_depth: Option<u32>,
    #[serde(default)]
    pub sampling_rate: Option<u32>,
    #[serde(default)]
    pub channel_count: Option<u32>,
    /// OpenSubsonic/Navidrome explicit content status ("explicit" | "clean" | "").
    #[serde(default)]
    pub explicit_status: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub status: PlaybackStatus,
    pub position: f64,
    pub duration: f64,
    pub volume: f64,
    pub muted: bool,
    pub replaygain: ReplayGainMode,
    pub buffering: bool,
    pub track: Option<TrackInfo>,
}

pub enum Command {
    Load {
        url: String,
        track: TrackInfo,
        start_position: f64,
    },
    Play,
    Pause,
    Stop,
    Seek(f64),
    SeekBy(f64),
    SetVolume(f64),
    SetMute(bool),
    SetReplayGain(ReplayGainMode),
    SetPreamp(f64),
    Preload {
        url: String,
        track: TrackInfo,
    },
    ClearPreload,
    SetLevelsEnabled(bool),
    SetTransition(TransitionMode, f64),
    FadeOut {
        seconds: f64,
        pause_after: bool,
    },
    SleepAtTrackEnd {
        fade_seconds: f64,
    },
    CancelSleep,
    /// Ask the engine for the pipeline's exact position (used for lyric tap-sync).
    QueryPosition(Sender<f64>),
}

#[derive(Clone)]
pub struct PlayerHandle {
    tx: Sender<Command>,
    snapshot: Arc<Mutex<PlayerSnapshot>>,
}

impl PlayerHandle {
    pub fn sender(&self) -> Sender<Command> {
        self.tx.clone()
    }

    pub fn send(&self, command: Command) {
        let _ = self.tx.send(command);
    }

    pub fn snapshot(&self) -> PlayerSnapshot {
        self.snapshot
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    /// Exact playback position in seconds, queried from the GStreamer pipeline.
    /// Falls back to the periodically-updated snapshot if the engine is busy.
    pub fn position_now(&self) -> f64 {
        let (tx, rx) = mpsc::channel();
        if self.tx.send(Command::QueryPosition(tx)).is_err() {
            return self.snapshot().position;
        }
        rx.recv_timeout(std::time::Duration::from_millis(250))
            .unwrap_or_else(|_| self.snapshot().position)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        app: tauri::AppHandle,
        discord: DiscordHandle,
        mpris: MprisHandle,
        waveforms: WaveformHandle,
        volume: f64,
        muted: bool,
        replaygain: ReplayGainMode,
        preamp: f64,
        transition_mode: TransitionMode,
        fade_seconds: f64,
    ) -> Self {
        let (tx, rx) = mpsc::channel();
        let snapshot = Arc::new(Mutex::new(PlayerSnapshot {
            volume: volume.clamp(0.0, 1.0),
            muted,
            replaygain,
            ..Default::default()
        }));
        let snapshot_for_thread = snapshot.clone();

        let _ = std::thread::Builder::new()
            .name("hush-gstreamer".to_string())
            .spawn(move || {
                engine::run(
                    app,
                    rx,
                    snapshot_for_thread,
                    discord,
                    mpris,
                    waveforms,
                    volume,
                    muted,
                    replaygain,
                    preamp,
                    transition_mode,
                    fade_seconds,
                );
            });

        Self { tx, snapshot }
    }
}

#[cfg(test)]
mod tests {
    use super::TrackInfo;

    /// The player bar links to the album/artist pages, so the IDs must survive
    /// the frontend → Rust → `hush://track` round trip.
    #[test]
    fn track_info_keeps_album_and_artist_ids() {
        let json = r#"{
            "id": "track",
            "title": "Song",
            "artist": "Artist",
            "artistId": "artist-1",
            "album": "Album",
            "albumId": "album-1"
        }"#;
        let track: TrackInfo = serde_json::from_str(json).expect("track");
        assert_eq!(track.artist_id.as_deref(), Some("artist-1"));
        assert_eq!(track.album_id.as_deref(), Some("album-1"));

        let encoded = serde_json::to_string(&track).expect("serialize");
        assert!(encoded.contains("\"artistId\":\"artist-1\""));
        assert!(encoded.contains("\"albumId\":\"album-1\""));
    }

    #[test]
    fn track_info_ids_default_to_none() {
        let track: TrackInfo =
            serde_json::from_str(r#"{"id":"track","title":"Song"}"#).expect("track");
        assert!(track.album_id.is_none());
        assert!(track.artist_id.is_none());
    }
}
