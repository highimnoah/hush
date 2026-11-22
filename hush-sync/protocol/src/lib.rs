use serde::{Deserialize, Serialize};

/// Bump when the wire format changes in a breaking way.
pub const PROTOCOL_VERSION: u32 = 1;

/// Length of a room join code.
pub const CODE_LEN: usize = 6;

/// Maximum number of people in one room.
pub const MAX_MEMBERS: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub name: String,
    pub is_host: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover_art: Option<String>,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub track: Option<SessionTrack>,
    /// Playback position in seconds at `host_clock`.
    pub position: f64,
    pub playing: bool,
    /// Host monotonic clock in seconds (host-local epoch).
    pub host_clock: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ClientMessage {
    Hello { name: String, protocol: u32 },
    Create,
    Join { code: String },
    Leave,
    State { state: SessionState },
    SyncReq { nonce: u64, t0: f64 },
    SyncResp {
        to: String,
        nonce: u64,
        t1: f64,
        t2: f64,
    },
    Heartbeat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ServerMessage {
    Welcome { id: String },
    Created { code: String },
    Joined {
        code: String,
        host_id: String,
        members: Vec<Member>,
    },
    MemberJoined { member: Member },
    MemberLeft { id: String },
    HostChanged { host_id: String },
    State { state: SessionState },
    SyncReq { from: String, nonce: u64, t0: f64 },
    SyncResp { nonce: u64, t1: f64, t2: f64 },
    Error { message: String },
}
