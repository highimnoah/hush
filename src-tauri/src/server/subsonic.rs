use async_trait::async_trait;
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use url::Url;

use super::types::*;
use super::{AlbumSort, MusicServer, StarKind};
use crate::config::Settings;
use crate::error::{HushError, Result};

enum Auth {
    Token { token: String, salt: String },
    Password(String),
}

pub struct SubsonicClient {
    http: Client,
    base: Url,
    username: String,
    auth: Auth,
    client_name: String,
    api_version: String,
}

impl SubsonicClient {
    pub fn new(settings: &Settings, http: Client) -> Result<Self> {
        let mut raw = settings.server_url.trim().trim_end_matches('/').to_string();
        if raw.is_empty() {
            return Err(HushError::NotConfigured);
        }
        if !raw.starts_with("http://") && !raw.starts_with("https://") {
            raw = format!("https://{raw}");
        }
        let base = Url::parse(&raw)?;
        let auth = if settings.has_token() {
            Auth::Token {
                token: settings.token.trim().to_string(),
                salt: settings.salt.trim().to_string(),
            }
        } else {
            Auth::Password(settings.password.clone())
        };
        Ok(Self {
            http,
            base,
            username: settings.username.trim().to_string(),
            auth,
            client_name: "hush".to_string(),
            api_version: "1.16.1".to_string(),
        })
    }

    fn endpoint(&self, method: &str, extra: &[(&str, String)]) -> Result<Url> {
        let base = self.base.as_str().trim_end_matches('/');
        let mut url = Url::parse(&format!("{base}/rest/{method}"))?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("u", &self.username);
            match &self.auth {
                Auth::Token { token, salt } => {
                    query.append_pair("t", token);
                    query.append_pair("s", salt);
                }
                Auth::Password(password) => {
                    query.append_pair("p", password);
                }
            }
            query.append_pair("v", &self.api_version);
            query.append_pair("c", &self.client_name);
            query.append_pair("f", "json");
            for (key, value) in extra {
                query.append_pair(key, value);
            }
        }
        Ok(url)
    }

    async fn call<T: DeserializeOwned>(
        &self,
        method: &str,
        extra: &[(&str, String)],
    ) -> Result<SubResponse<T>> {
        let url = self.endpoint(method, extra)?;
        let response = self.http.get(url).send().await?;
        let status = response.status();
        let body = response.text().await?;

        if !status.is_success() {
            return Err(HushError::Server(format!(
                "The server returned HTTP {} for `{method}`.",
                status.as_u16()
            )));
        }

        let envelope: Envelope<T> = serde_json::from_str(&body).map_err(|err| {
            HushError::Server(format!("Could not read the server response for `{method}`: {err}"))
        })?;

        let response = envelope.response;
        if response.status != "ok" {
            let (code, message) = response
                .error
                .map(|e| (e.code, e.message))
                .unwrap_or((0, "Unknown server error".to_string()));
            return Err(map_error(code, message));
        }
        Ok(response)
    }
}

fn map_error(code: i64, message: String) -> HushError {
    let trimmed = message.trim().to_string();
    match code {
        40 | 41 | 50 => HushError::Auth(if trimmed.is_empty() {
            "Wrong username, password or token.".into()
        } else {
            trimmed
        }),
        70 => HushError::Server(format!(
            "Not found: {}",
            if trimmed.is_empty() { "requested item" } else { &trimmed }
        )),
        _ => HushError::Server(if trimmed.is_empty() {
            format!("Server error (code {code})")
        } else {
            trimmed
        }),
    }
}

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct Envelope<T> {
    #[serde(rename = "subsonic-response")]
    response: SubResponse<T>,
}

#[derive(Deserialize)]
struct SubResponse<T> {
    status: String,
    #[serde(default)]
    #[allow(dead_code)]
    version: Option<String>,
    #[serde(default)]
    error: Option<ApiError>,
    #[serde(flatten)]
    payload: T,
}

#[derive(Deserialize)]
struct ApiError {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
}

// ---------------------------------------------------------------------------
// Endpoint payloads
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
struct Empty {}

#[derive(Deserialize, Default)]
struct PingPayload {
    #[serde(default, rename = "type")]
    kind: Option<String>,
}

#[derive(Deserialize, Default)]
struct ArtistsPayload {
    #[serde(default)]
    artists: Artists,
}

#[derive(Deserialize, Default)]
struct Artists {
    #[serde(default)]
    index: Vec<ArtistIndex>,
}

#[derive(Deserialize, Default)]
struct ArtistIndex {
    #[serde(default)]
    artist: Vec<Artist>,
}

#[derive(Deserialize, Default)]
struct AlbumListPayload {
    #[serde(default, rename = "albumList2")]
    album_list2: AlbumList,
}

#[derive(Deserialize, Default)]
struct AlbumList {
    #[serde(default)]
    album: Vec<Album>,
}

#[derive(Deserialize)]
struct AlbumPayload {
    album: Value,
}

#[derive(Deserialize)]
struct ArtistPayload {
    artist: Value,
}

#[derive(Deserialize)]
struct SongPayload {
    song: Song,
}

#[derive(Deserialize, Default)]
struct PlaylistsPayload {
    #[serde(default)]
    playlists: Playlists,
}

#[derive(Deserialize, Default)]
struct Playlists {
    #[serde(default)]
    playlist: Vec<Playlist>,
}

#[derive(Deserialize)]
struct PlaylistPayload {
    playlist: Value,
}

#[derive(Deserialize, Default)]
struct SearchPayload {
    #[serde(default, rename = "searchResult3")]
    search_result3: SearchResult,
}

#[derive(Deserialize, Default)]
struct StarredPayload {
    #[serde(default, rename = "starred2")]
    starred2: SearchResult,
}

#[derive(Deserialize, Default)]
struct SearchResult {
    #[serde(default)]
    artist: Vec<Artist>,
    #[serde(default)]
    album: Vec<Album>,
    #[serde(default)]
    song: Vec<Song>,
}

#[derive(Deserialize, Default)]
struct RandomSongsPayload {
    #[serde(default, rename = "randomSongs")]
    random_songs: RandomSongs,
}

#[derive(Deserialize, Default)]
struct RandomSongs {
    #[serde(default)]
    song: Vec<Song>,
}

#[derive(Deserialize, Default)]
struct GenresPayload {
    #[serde(default)]
    genres: Genres,
}

#[derive(Deserialize, Default)]
struct Genres {
    #[serde(default)]
    genre: Vec<Genre>,
}

#[derive(Deserialize, Default)]
struct SongsByGenrePayload {
    #[serde(default, rename = "songsByGenre")]
    songs_by_genre: SongsByGenre,
}

#[derive(Deserialize, Default)]
struct SongsByGenre {
    #[serde(default)]
    song: Vec<Song>,
}

#[derive(Deserialize, Default)]
struct CreatePlaylistPayload {
    #[serde(default)]
    playlist: Option<Value>,
}

#[derive(Deserialize, Default)]
struct LyricsPayload {
    #[serde(default, rename = "lyricsList")]
    lyrics_list: LyricsList,
}

#[derive(Deserialize, Default)]
struct LyricsList {
    #[serde(default, rename = "structuredLyrics")]
    structured_lyrics: Vec<StructuredLyrics>,
}

#[derive(Deserialize, Default)]
struct StructuredLyrics {
    #[serde(default)]
    value: Option<String>,
    #[serde(default, rename = "displayArtist")]
    display_artist: Option<String>,
    #[serde(default, rename = "displayTitle")]
    display_title: Option<String>,
    #[serde(default)]
    synced: bool,
    #[serde(default, deserialize_with = "opt_f64")]
    offset: Option<f64>,
    #[serde(default)]
    line: Vec<StructuredLyricLine>,
}

#[derive(Deserialize, Default)]
struct StructuredLyricLine {
    #[serde(default, deserialize_with = "opt_f64")]
    start: Option<f64>,
    #[serde(default)]
    value: String,
}

fn take_songs(value: &Value) -> Vec<Song> {
    value
        .get("song")
        .and_then(|songs| serde_json::from_value::<Vec<Song>>(songs.clone()).ok())
        .unwrap_or_default()
}

fn take_albums(value: &Value) -> Vec<Album> {
    value
        .get("album")
        .and_then(|albums| serde_json::from_value::<Vec<Album>>(albums.clone()).ok())
        .unwrap_or_default()
}

fn take_entries(value: &Value) -> Vec<Song> {
    value
        .get("entry")
        .and_then(|entries| serde_json::from_value::<Vec<Song>>(entries.clone()).ok())
        .unwrap_or_default()
}

#[async_trait]
impl MusicServer for SubsonicClient {
    async fn ping(&self) -> Result<ServerInfo> {
        let response = self.call::<PingPayload>("ping", &[]).await?;
        Ok(ServerInfo {
            version: response.version.unwrap_or_default(),
            kind: response.payload.kind,
            name: None,
        })
    }

    async fn artists(&self) -> Result<Vec<Artist>> {
        let response = self.call::<ArtistsPayload>("getArtists", &[]).await?;
        let mut artists = Vec::new();
        for index in response.payload.artists.index {
            artists.extend(index.artist);
        }
        Ok(artists)
    }

    async fn album_list(&self, sort: AlbumSort, size: u32, offset: u32) -> Result<Vec<Album>> {
        let mut extra = vec![
            ("type", sort.as_str().to_string()),
            ("size", size.to_string()),
            ("offset", offset.to_string()),
        ];
        if sort == AlbumSort::ByYear {
            extra.push(("fromYear", "0".to_string()));
            extra.push(("toYear", "3000".to_string()));
        }
        let response = self.call::<AlbumListPayload>("getAlbumList2", &extra).await?;
        Ok(response.payload.album_list2.album)
    }

    async fn album(&self, id: &str) -> Result<AlbumDetail> {
        let response = self
            .call::<AlbumPayload>("getAlbum", &[("id", id.to_string())])
            .await?;
        let value = response.payload.album;
        let album: Album = serde_json::from_value(value.clone())?;
        let songs = take_songs(&value);
        Ok(AlbumDetail { album, songs })
    }

    async fn artist(&self, id: &str) -> Result<ArtistDetail> {
        let response = self
            .call::<ArtistPayload>("getArtist", &[("id", id.to_string())])
            .await?;
        let value = response.payload.artist;
        let artist: Artist = serde_json::from_value(value.clone())?;
        let albums = take_albums(&value);
        Ok(ArtistDetail { artist, albums })
    }

    async fn song(&self, id: &str) -> Result<Song> {
        let response = self
            .call::<SongPayload>("getSong", &[("id", id.to_string())])
            .await?;
        Ok(response.payload.song)
    }

    async fn playlists(&self) -> Result<Vec<Playlist>> {
        let response = self.call::<PlaylistsPayload>("getPlaylists", &[]).await?;
        Ok(response.payload.playlists.playlist)
    }

    async fn playlist(&self, id: &str) -> Result<PlaylistDetail> {
        let response = self
            .call::<PlaylistPayload>("getPlaylist", &[("id", id.to_string())])
            .await?;
        let value = response.payload.playlist;
        let playlist: Playlist = serde_json::from_value(value.clone())?;
        let songs = take_entries(&value);
        Ok(PlaylistDetail { playlist, songs })
    }

    async fn search(&self, query: &str) -> Result<SearchResults> {
        let response = self
            .call::<SearchPayload>(
                "search3",
                &[
                    ("query", query.to_string()),
                    ("artistCount", "20".to_string()),
                    ("albumCount", "20".to_string()),
                    ("songCount", "80".to_string()),
                ],
            )
            .await?;
        let result = response.payload.search_result3;
        Ok(SearchResults {
            artists: result.artist,
            albums: result.album,
            songs: result.song,
        })
    }

    async fn starred(&self) -> Result<SearchResults> {
        let response = self.call::<StarredPayload>("getStarred2", &[]).await?;
        let result = response.payload.starred2;
        Ok(SearchResults {
            artists: result.artist,
            albums: result.album,
            songs: result.song,
        })
    }

    async fn random_songs(&self, size: u32) -> Result<Vec<Song>> {
        let response = self
            .call::<RandomSongsPayload>("getRandomSongs", &[("size", size.to_string())])
            .await?;
        Ok(response.payload.random_songs.song)
    }

    async fn lyrics(&self, id: &str) -> Result<Lyrics> {
        let response = self
            .call::<LyricsPayload>("getLyricsBySongId", &[("id", id.to_string())])
            .await?;

        let mut entries = response.payload.lyrics_list.structured_lyrics;
        if entries.is_empty() {
            return Ok(Lyrics::default());
        }

        // Prefer a synced entry; fall back to plain text.
        entries.sort_by_key(|entry| !entry.synced);
        let entry = entries.remove(0);
        let offset = entry.offset.unwrap_or(0.0);

        let synced = if entry.synced && !entry.line.is_empty() {
            let mut lines: Vec<LyricLine> = entry
                .line
                .iter()
                .map(|line| LyricLine {
                    start_ms: ((line.start.unwrap_or(0.0) + offset).max(0.0)).round() as u64,
                    text: line.value.clone(),
                })
                .collect();
            lines.sort_by_key(|line| line.start_ms);
            Some(lines)
        } else {
            None
        };

        let plain = entry.value.clone().or_else(|| {
            if synced.is_none() && !entry.line.is_empty() {
                Some(
                    entry
                        .line
                        .iter()
                        .map(|line| line.value.clone())
                        .collect::<Vec<_>>()
                        .join("\n"),
                )
            } else {
                None
            }
        });

        Ok(Lyrics {
            plain,
            synced,
            title: entry.display_title,
            artist: entry.display_artist,
            album: None,
        })
    }

    async fn genres(&self) -> Result<Vec<Genre>> {
        let response = self.call::<GenresPayload>("getGenres", &[]).await?;
        Ok(response.payload.genres.genre)
    }

    async fn songs_by_genre(&self, genre: &str, size: u32, offset: u32) -> Result<Vec<Song>> {
        let response = self
            .call::<SongsByGenrePayload>(
                "getSongsByGenre",
                &[
                    ("genre", genre.to_string()),
                    ("count", size.to_string()),
                    ("offset", offset.to_string()),
                ],
            )
            .await?;
        Ok(response.payload.songs_by_genre.song)
    }

    async fn albums_by_genre(&self, genre: &str, size: u32, offset: u32) -> Result<Vec<Album>> {
        let response = self
            .call::<AlbumListPayload>(
                "getAlbumList2",
                &[
                    ("type", "byGenre".to_string()),
                    ("genre", genre.to_string()),
                    ("size", size.to_string()),
                    ("offset", offset.to_string()),
                ],
            )
            .await?;
        Ok(response.payload.album_list2.album)
    }

    async fn create_playlist(
        &self,
        name: Option<&str>,
        playlist_id: Option<&str>,
        song_ids: &[String],
    ) -> Result<PlaylistDetail> {
        let mut extra: Vec<(&str, String)> = Vec::new();
        if let Some(name) = name {
            extra.push(("name", name.to_string()));
        }
        if let Some(id) = playlist_id {
            extra.push(("playlistId", id.to_string()));
        }
        for id in song_ids {
            extra.push(("songId", id.clone()));
        }

        let response = self
            .call::<CreatePlaylistPayload>("createPlaylist", &extra)
            .await?;

        if let Some(value) = response.payload.playlist {
            let playlist: Playlist = serde_json::from_value(value.clone())?;
            let songs = take_entries(&value);
            return Ok(PlaylistDetail { playlist, songs });
        }

        // Some servers return an empty payload; synthesize a best-effort value.
        Ok(PlaylistDetail {
            playlist: Playlist {
                id: playlist_id.unwrap_or_default().to_string(),
                name: name.unwrap_or_default().to_string(),
                ..Default::default()
            },
            songs: Vec::new(),
        })
    }

    async fn update_playlist(
        &self,
        id: &str,
        name: Option<&str>,
        comment: Option<&str>,
        song_ids_to_add: &[String],
        song_indexes_to_remove: &[u32],
    ) -> Result<()> {
        let mut extra: Vec<(&str, String)> = vec![("playlistId", id.to_string())];
        if let Some(name) = name {
            extra.push(("name", name.to_string()));
        }
        if let Some(comment) = comment {
            extra.push(("comment", comment.to_string()));
        }
        for song in song_ids_to_add {
            extra.push(("songIdToAdd", song.clone()));
        }
        for index in song_indexes_to_remove {
            extra.push(("songIndexToRemove", index.to_string()));
        }
        let _ = self.call::<Empty>("updatePlaylist", &extra).await?;
        Ok(())
    }

    async fn delete_playlist(&self, id: &str) -> Result<()> {
        let _ = self
            .call::<Empty>("deletePlaylist", &[("id", id.to_string())])
            .await?;
        Ok(())
    }

    async fn scrobble(&self, id: &str, submission: bool) -> Result<()> {
        let _ = self
            .call::<Empty>(
                "scrobble",
                &[
                    ("id", id.to_string()),
                    ("submission", submission.to_string()),
                ],
            )
            .await?;
        Ok(())
    }

    async fn set_star(&self, kind: StarKind, id: &str, starred: bool) -> Result<()> {
        let method = if starred { "star" } else { "unstar" };
        let parameter = match kind {
            StarKind::Song => "id",
            StarKind::Album => "albumId",
        };
        let _ = self
            .call::<Empty>(method, &[(parameter, id.to_string())])
            .await?;
        Ok(())
    }

    fn stream_url(&self, id: &str) -> String {
        self.endpoint("stream", &[("id", id.to_string())])
            .map(|url| url.to_string())
            .unwrap_or_default()
    }

    fn cover_url(&self, id: &str, size: u32) -> String {
        self.endpoint(
            "getCoverArt",
            &[("id", id.to_string()), ("size", size.to_string())],
        )
        .map(|url| url.to_string())
        .unwrap_or_default()
    }
}
