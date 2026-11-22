pub mod service;

use std::sync::{Arc, Mutex};

use hush_session_protocol::Member;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionRole {
    #[default]
    None,
    Host,
    Guest,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncStatus {
    #[default]
    Idle,
    Synced,
    Drifting,
    Disconnected,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub role: SessionRole,
    pub code: Option<String>,
    pub name: String,
    pub relay_url: String,
    pub host_id: Option<String>,
    pub members: Vec<Member>,
    pub connected: bool,
    pub sync: SyncStatus,
    pub drift_ms: Option<f64>,
    pub now_playing: Option<hush_session_protocol::SessionTrack>,
    pub playing: bool,
    pub error: Option<String>,
}

pub enum SessionCommand {
    Create,
    Join { code: String },
    Leave,
}

#[derive(Clone)]
pub struct SessionHandle {
    commands: tokio::sync::mpsc::UnboundedSender<SessionCommand>,
    snapshot: Arc<Mutex<SessionSnapshot>>,
}

impl SessionHandle {
    pub fn spawn(
        app: tauri::AppHandle,
        player: crate::player::PlayerHandle,
        config: Arc<crate::config::ConfigStore>,
        http: reqwest::Client,
    ) -> Self {
        let (commands, command_rx) = tokio::sync::mpsc::unbounded_channel();
        let snapshot = Arc::new(Mutex::new(SessionSnapshot::default()));
        let snapshot_for_thread = snapshot.clone();

        let _ = std::thread::Builder::new()
            .name("hush-session".to_string())
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(err) => {
                        eprintln!("[hush] could not start session runtime: {err}");
                        return;
                    }
                };
                runtime.block_on(service::run(
                    app,
                    player,
                    config,
                    http,
                    command_rx,
                    snapshot_for_thread,
                ));
            });

        Self { commands, snapshot }
    }

    pub fn create(&self) {
        let _ = self.commands.send(SessionCommand::Create);
    }

    pub fn join(&self, code: String) {
        let _ = self.commands.send(SessionCommand::Join { code });
    }

    pub fn leave(&self) {
        let _ = self.commands.send(SessionCommand::Leave);
    }

    pub fn snapshot(&self) -> SessionSnapshot {
        self.snapshot
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }
}
