use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// Lenient numeric deserializers: different Subsonic-compatible servers emit
/// numbers as either JSON numbers or strings.
fn json_to_u64(v: &Value) -> Option<u64> {
    match v {
        Value::Number(n) => n
            .as_u64()
            .or_else(|| n.as_f64().map(|f| f.max(0.0) as u64)),
        Value::String(s) => s
            .trim()
            .parse::<u64>()
            .ok()
            .or_else(|| s.trim().parse::<f64>().ok().map(|f| f.max(0.0) as u64)),
        _ => None,
    }
}

fn json_to_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

pub fn opt_u32<'de, D>(deserializer: D) -> std::result::Result<Option<u32>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<Value>::deserialize(deserializer)?;
    Ok(v.as_ref().and_then(json_to_u64).map(|n| n as u32))
}

pub fn opt_u64<'de, D>(deserializer: D) -> std::result::Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<Value>::deserialize(deserializer)?;
    Ok(v.as_ref().and_then(json_to_u64))
}

pub fn opt_f64<'de, D>(deserializer: D) -> std::result::Result<Option<f64>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<Value>::deserialize(deserializer)?;
    Ok(v.as_ref().and_then(json_to_f64))
}

/// Lenient string-ish deserializer. Some servers emit explicit flags as
/// booleans or numbers instead of the OpenSubsonic "explicit"/"clean" string.
pub fn opt_string_lossy<'de, D>(deserializer: D) -> std::result::Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<Value>::deserialize(deserializer)?;
    Ok(v.and_then(|value| match value {
        Value::String(s) => Some(s),
        Value::Bool(true) => Some("explicit".to_string()),
        Value::Bool(false) => Some("clean".to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub album_artist: Option<String>,
    #[serde(default)]
    pub album_id: Option<String>,
    #[serde(default)]
    pub artist_id: Option<String>,
    #[serde(default)]
    pub cover_art: Option<String>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub duration: Option<u32>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub track: Option<u32>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub disc_number: Option<u32>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub year: Option<u32>,
    #[serde(default)]
    pub genre: Option<String>,
    #[serde(default)]
    pub suffix: Option<String>,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub bit_rate: Option<u32>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub bit_depth: Option<u32>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub sampling_rate: Option<u32>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub channel_count: Option<u32>,
    #[serde(default, deserialize_with = "opt_u64")]
    pub size: Option<u64>,
    #[serde(default)]
    pub starred: Option<String>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub play_count: Option<u32>,
    /// OpenSubsonic/Navidrome explicit content status: "explicit", "clean" or "".
    #[serde(default, deserialize_with = "opt_string_lossy")]
    pub explicit_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub artist_id: Option<String>,
    #[serde(default)]
    pub cover_art: Option<String>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub song_count: Option<u32>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub duration: Option<u32>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub year: Option<u32>,
    #[serde(default)]
    pub genre: Option<String>,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub starred: Option<String>,
    /// OpenSubsonic/Navidrome explicit content status for the album.
    #[serde(default, deserialize_with = "opt_string_lossy")]
    pub explicit_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Genre {
    #[serde(default)]
    pub value: String,
    #[serde(default, deserialize_with = "opt_u32")]
    pub song_count: Option<u32>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub album_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Artist {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, deserialize_with = "opt_u32")]
    pub album_count: Option<u32>,
    #[serde(default)]
    pub cover_art: Option<String>,
    #[serde(default)]
    pub artist_image_url: Option<String>,
    #[serde(default)]
    pub starred: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumDetail {
    pub album: Album,
    pub songs: Vec<Song>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDetail {
    pub artist: Artist,
    pub albums: Vec<Album>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub song_count: Option<u32>,
    #[serde(default, deserialize_with = "opt_u32")]
    pub duration: Option<u32>,
    #[serde(default)]
    pub cover_art: Option<String>,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub changed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetail {
    pub playlist: Playlist,
    pub songs: Vec<Song>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    #[serde(default)]
    pub artists: Vec<Artist>,
    #[serde(default)]
    pub albums: Vec<Album>,
    #[serde(default)]
    pub songs: Vec<Song>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LyricsSource {
    #[default]
    None,
    Local,
    Server,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    #[serde(default)]
    pub plain: Option<String>,
    #[serde(default)]
    pub synced: Option<Vec<LyricLine>>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub album: Option<String>,
    /// Where the lyrics came from: `local` (hush's editable layer) or `server`.
    #[serde(default)]
    pub source: LyricsSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    /// Line start time in milliseconds.
    pub start_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}
