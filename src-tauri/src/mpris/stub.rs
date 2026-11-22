//! No-op media controls for platforms without MPRIS (Windows, macOS).

use tauri::AppHandle;

use crate::config::RepeatMode;
use crate::player::{PlaybackStatus, TrackInfo};

#[derive(Clone, Default)]
pub struct MprisHandle;

impl MprisHandle {
    pub fn spawn(_app: AppHandle) -> Self {
        Self
    }

    pub fn set_status(&self, _status: PlaybackStatus) {}

    pub fn set_metadata(&self, _track: &TrackInfo) {}

    pub fn clear_metadata(&self) {}

    pub fn set_position(&self, _position: f64) {}

    pub fn set_volume(&self, _volume: f64) {}

    pub fn set_shuffle(&self, _shuffle: bool) {}

    pub fn set_repeat(&self, _repeat: RepeatMode) {}

    pub fn seeked(&self, _position: f64) {}
}
