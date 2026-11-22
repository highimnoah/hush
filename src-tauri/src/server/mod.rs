pub mod subsonic;
pub mod types;

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::config::Settings;
use crate::error::{HushError, Result};
use types::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AlbumSort {
    Newest,
    Recent,
    Frequent,
    Alphabetical,
    Random,
    Starred,
    ByYear,
}

impl AlbumSort {
    pub fn as_str(self) -> &'static str {
        match self {
            AlbumSort::Newest => "newest",
            AlbumSort::Recent => "recent",
            AlbumSort::Frequent => "frequent",
            AlbumSort::Alphabetical => "alphabeticalByName",
            AlbumSort::Random => "random",
            AlbumSort::Starred => "starred",
            AlbumSort::ByYear => "byYear",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "recent" => AlbumSort::Recent,
            "frequent" => AlbumSort::Frequent,
            "alphabetical" | "alphabeticalByName" => AlbumSort::Alphabetical,
            "random" => AlbumSort::Random,
            "starred" => AlbumSort::Starred,
            "byYear" => AlbumSort::ByYear,
            _ => AlbumSort::Newest,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StarKind {
    Song,
    Album,
}

/// Abstraction over a music server. Navidrome/Subsonic is the first
/// implementation; other backends can implement this trait later.
#[async_trait]
pub trait MusicServer: Send + Sync {
    async fn ping(&self) -> Result<ServerInfo>;
    async fn artists(&self) -> Result<Vec<Artist>>;
    async fn album_list(&self, sort: AlbumSort, size: u32, offset: u32) -> Result<Vec<Album>>;
    async fn album(&self, id: &str) -> Result<AlbumDetail>;
    async fn artist(&self, id: &str) -> Result<ArtistDetail>;
    async fn song(&self, id: &str) -> Result<Song>;
    async fn playlists(&self) -> Result<Vec<Playlist>>;
    async fn playlist(&self, id: &str) -> Result<PlaylistDetail>;
    async fn search(&self, query: &str) -> Result<SearchResults>;
    async fn starred(&self) -> Result<SearchResults>;
    async fn random_songs(&self, size: u32) -> Result<Vec<Song>>;
    async fn scrobble(&self, id: &str, submission: bool) -> Result<()>;
    async fn set_star(&self, kind: StarKind, id: &str, starred: bool) -> Result<()>;

    fn stream_url(&self, id: &str) -> String;
    fn cover_url(&self, id: &str, size: u32) -> String;
}

/// Build a configured server adapter from settings.
pub fn build(settings: &Settings, http: reqwest::Client) -> Result<Arc<dyn MusicServer>> {
    if !settings.is_configured() {
        return Err(HushError::NotConfigured);
    }
    Ok(Arc::new(subsonic::SubsonicClient::new(settings, http)?))
}
