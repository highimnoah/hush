use serde::Serialize;

/// Unified application error. Serializes to a plain string so the frontend can
/// surface a friendly message.
#[derive(Debug, thiserror::Error)]
pub enum HushError {
    #[error("The music server is not configured yet.")]
    NotConfigured,

    #[error("Authentication failed: {0}")]
    Auth(String),

    #[error("Server error: {0}")]
    Server(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("Playback error: {0}")]
    Playback(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid URL: {0}")]
    Url(#[from] url::ParseError),

    #[error("Invalid data: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

impl Serialize for HushError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<reqwest::Error> for HushError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            HushError::Network("The request timed out. Is the server reachable?".into())
        } else if err.is_connect() {
            HushError::Network("Could not connect to the server.".into())
        } else {
            HushError::Network(err.to_string())
        }
    }
}

pub type Result<T> = std::result::Result<T, HushError>;
