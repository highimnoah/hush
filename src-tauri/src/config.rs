use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{HushError, Result};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReplayGainMode {
    #[default]
    Off,
    Track,
    Album,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    #[default]
    Off,
    One,
    All,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransitionMode {
    #[default]
    Gapless,
    Fade,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtistImageMode {
    Off,
    /// Only use images provided by the music server (`artistImageUrl`).
    Server,
    /// Also fetch missing images from public providers (Deezer, iTunes).
    #[default]
    Auto,
}

/// Persisted application settings. Stored as JSON in the app config directory.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    // --- server ---
    pub server_url: String,
    pub username: String,
    /// Plain password (fallback when no token is configured).
    pub password: String,
    /// Subsonic token (`t`) — preferred over password.
    pub token: String,
    /// Salt (`s`) matching the token.
    pub salt: String,
    /// Optional human-friendly server name used in Discord templates.
    pub server_name: String,

    // --- playback ---
    pub replaygain: ReplayGainMode,
    pub replaygain_preamp: f64,
    pub volume: f64,
    pub muted: bool,
    /// Restore the saved queue and start playing automatically on launch.
    pub resume_playback: bool,
    /// Track boundary behaviour: hard gapless switch or a short fade.
    pub transition_mode: TransitionMode,
    /// Fade length in seconds (1–8) for `transition_mode = "fade"`.
    pub fade_seconds: u32,

    // --- discord ---
    pub discord_enabled: bool,
    pub discord_client_id: String,
    pub discord_details: String,
    pub discord_state: String,
    pub discord_large_image: String,
    pub discord_timestamps: bool,
    pub discord_use_cover: bool,

    // --- appearance / misc ---
    pub accent: String,
    /// Whether the fullscreen sidebar was visible last time.
    pub fullscreen_sidebar_open: bool,
    /// Last active fullscreen sidebar tab: "queue", "lyrics" or "info".
    pub fullscreen_sidebar_panel: String,
    /// Artist artwork: off, server-only, or automatic external fetch.
    pub artist_images: ArtistImageMode,

    // --- updates ---
    /// Check for a new release shortly after launch.
    pub auto_update: bool,

    // --- listen together ---
    pub session_name: String,
    pub session_relay_url: String,

    // --- window state (persisted on exit) ---
    pub window_width: Option<u32>,
    pub window_height: Option<u32>,
    pub window_maximized: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            username: String::new(),
            password: String::new(),
            token: String::new(),
            salt: String::new(),
            server_name: String::new(),

            replaygain: ReplayGainMode::Off,
            replaygain_preamp: 0.0,
            volume: 0.8,
            muted: false,
            resume_playback: false,
            transition_mode: TransitionMode::Gapless,
            fade_seconds: 3,

            discord_enabled: false,
            discord_client_id: "1573866319844212849".into(),
            discord_details: "{title}".into(),
            discord_state: "by {artist}".into(),
            discord_large_image: "hush".into(),
            discord_timestamps: true,
            discord_use_cover: true,

            accent: "blue".into(),
            fullscreen_sidebar_open: true,
            fullscreen_sidebar_panel: "queue".into(),
            artist_images: ArtistImageMode::Auto,

            auto_update: true,

            session_name: String::new(),
            session_relay_url: "ws://127.0.0.1:8787".into(),

            window_width: None,
            window_height: None,
            window_maximized: false,
        }
    }
}

impl Settings {
    pub fn has_token(&self) -> bool {
        !self.token.trim().is_empty() && !self.salt.trim().is_empty()
    }

    pub fn has_password(&self) -> bool {
        !self.password.is_empty()
    }

    pub fn is_configured(&self) -> bool {
        !self.server_url.trim().is_empty()
            && !self.username.trim().is_empty()
            && (self.has_token() || self.has_password())
    }

    /// Best-effort host name for display / templates.
    pub fn display_server_name(&self) -> String {
        if !self.server_name.trim().is_empty() {
            return self.server_name.trim().to_string();
        }
        let url = self.server_url.trim();
        let without_scheme = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))
            .unwrap_or(url);
        let host = without_scheme.split('/').next().unwrap_or(without_scheme);
        if host.is_empty() {
            "Navidrome".to_string()
        } else {
            host.to_string()
        }
    }
}

/// Thread-safe settings store with atomic on-disk persistence.
pub struct ConfigStore {
    path: PathBuf,
    inner: Mutex<Settings>,
}

impl ConfigStore {
    pub fn load(config_dir: PathBuf) -> Self {
        let path = config_dir.join("settings.json");
        let settings = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(settings),
        }
    }

    pub fn get(&self) -> Settings {
        self.inner
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    pub fn set(&self, settings: Settings) -> Result<Settings> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(&settings)?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, &json)?;
        std::fs::rename(&tmp, &self.path)?;
        if let Ok(mut guard) = self.inner.lock() {
            *guard = settings.clone();
        }
        Ok(settings)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

pub fn ensure_config_dir(dir: &Path) -> Result<()> {
    std::fs::create_dir_all(dir).map_err(HushError::from)
}
