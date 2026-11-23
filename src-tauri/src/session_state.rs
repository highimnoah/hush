use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::config::RepeatMode;
use crate::error::Result;
use crate::server::types::Song;

/// Queue + transport snapshot persisted between launches. The frontend owns the
/// queue, so it serializes it and hands it to this store.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PersistedPlayerState {
    pub queue: Vec<Song>,
    pub base_queue: Vec<Song>,
    pub current_index: u32,
    pub position: f64,
    pub shuffle: bool,
    pub repeat: RepeatMode,
    pub saved_at: u64,
}

/// Small atomic JSON store for the last player session.
pub struct SessionStore {
    path: PathBuf,
    inner: Mutex<Option<PersistedPlayerState>>,
}

impl SessionStore {
    pub fn load(config_dir: PathBuf) -> Self {
        let path = config_dir.join("player-session.json");
        let state = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<PersistedPlayerState>(&raw).ok());
        Self {
            path,
            inner: Mutex::new(state),
        }
    }

    pub fn get(&self) -> Option<PersistedPlayerState> {
        self.inner.lock().ok().and_then(|guard| guard.clone())
    }

    pub fn set(&self, state: PersistedPlayerState) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string(&state)?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, &json)?;
        std::fs::rename(&tmp, &self.path)?;
        if let Ok(mut guard) = self.inner.lock() {
            *guard = Some(state);
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        if self.path.exists() {
            let _ = std::fs::remove_file(&self.path);
        }
        if let Ok(mut guard) = self.inner.lock() {
            *guard = None;
        }
        Ok(())
    }
}
