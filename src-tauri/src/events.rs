use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// A transport command originating from a native surface (tray, MPRIS media
/// keys). The frontend owns the queue, so transport actions are routed through
/// it to keep a single source of truth.
#[derive(Clone, Debug, Serialize)]
pub struct UiCommand {
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

pub const UI_COMMAND_EVENT: &str = "hush://command";

pub fn emit(app: &AppHandle, action: &str, value: Option<String>) {
    let _ = app.emit(
        UI_COMMAND_EVENT,
        UiCommand {
            action: action.to_string(),
            value,
        },
    );
}
