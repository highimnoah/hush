//! LRCLIB lyrics provider (https://lrclib.net).
//!
//! LRCLIB is a free, community-maintained lyrics database with a public JSON
//! API. It matches by track metadata rather than by music-server track id, so
//! callers pass the metadata they already have. Results are cached in memory
//! for the session (including misses) and never written to the editable local
//! lyrics layer — that stays user-owned.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::lyrics;
use crate::server::types::{Lyrics, LyricsSource};

const API: &str = "https://lrclib.net/api";
const TIMEOUT: Duration = Duration::from_secs(4);
const MAX_CACHE: usize = 2_000;
const USER_AGENT: &str = "hush/0.1.0 (https://github.com/highimnoah/hush)";

/// Metadata used to look a track up. Field names match the frontend `Song`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsMeta {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(default)]
    track_name: String,
    #[serde(default)]
    artist_name: String,
    #[serde(default)]
    album_name: String,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    plain_lyrics: Option<String>,
    #[serde(default)]
    synced_lyrics: Option<String>,
}

/// Session cache for LRCLIB lookups. `None` records a miss so a track is only
/// queried once per run.
pub struct Lrclib {
    http: reqwest::Client,
    cache: Mutex<HashMap<String, Option<Lyrics>>>,
    /// Politeness limit: a lyrics search can render many rows at once.
    permits: tokio::sync::Semaphore,
}

impl Lrclib {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            cache: Mutex::new(HashMap::new()),
            permits: tokio::sync::Semaphore::new(3),
        }
    }

    pub async fn lyrics(&self, track_id: &str, meta: &LyricsMeta) -> Option<Lyrics> {
        if track_id.is_empty() {
            return None;
        }
        if let Ok(cache) = self.cache.lock() {
            if let Some(hit) = cache.get(track_id) {
                return hit.clone();
            }
        }

        let Ok(_permit) = self.permits.acquire().await else {
            return None;
        };
        let found = self.lookup(meta).await;

        if let Ok(mut cache) = self.cache.lock() {
            if cache.len() >= MAX_CACHE {
                cache.clear();
            }
            cache.insert(track_id.to_string(), found.clone());
        }
        found
    }

    async fn lookup(&self, meta: &LyricsMeta) -> Option<Lyrics> {
        let title = meta
            .title
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())?;
        let artist = meta
            .artist
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or("");
        let album = meta
            .album
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let duration = meta.duration.filter(|value| *value > 0.0);

        // The signature endpoint needs artist, album and duration. Track names
        // alone are ambiguous, so only use it when the metadata is complete.
        let mut fallback: Option<Lyrics> = None;
        if !artist.is_empty() {
            if let (Some(album), Some(duration)) = (album, duration) {
                let params = [
                    ("track_name", title.to_string()),
                    ("artist_name", artist.to_string()),
                    ("album_name", album.to_string()),
                    ("duration", format!("{duration:.0}")),
                ];
                if let Some(record) = self.get(&params).await {
                    if let Some(lyrics) = record_to_lyrics(record) {
                        if lyrics.synced.is_some() {
                            return Some(lyrics);
                        }
                        fallback = Some(lyrics);
                    }
                }
            }
        }

        let mut params = vec![("track_name", title.to_string())];
        if !artist.is_empty() {
            params.push(("artist_name", artist.to_string()));
        }
        let records = self.search(&params).await;
        if let Some(best) = pick_best(records, meta) {
            // A different release sometimes carries the synced version even
            // when the exact signature only has plain lyrics.
            if best.synced.is_some() || fallback.is_none() {
                return Some(best);
            }
        }
        fallback
    }

    async fn get(&self, params: &[(&str, String)]) -> Option<Record> {
        let response = self
            .http
            .get(format!("{API}/get"))
            .header(reqwest::header::USER_AGENT, USER_AGENT)
            .query(params)
            .timeout(TIMEOUT)
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?;
        response.json::<Record>().await.ok()
    }

    async fn search(&self, params: &[(&str, String)]) -> Vec<Record> {
        let response = match self
            .http
            .get(format!("{API}/search"))
            .header(reqwest::header::USER_AGENT, USER_AGENT)
            .query(params)
            .timeout(TIMEOUT)
            .send()
            .await
        {
            Ok(response) => response,
            Err(_) => return Vec::new(),
        };
        if !response.status().is_success() {
            return Vec::new();
        }
        response.json::<Vec<Record>>().await.unwrap_or_default()
    }
}

fn pick_best(records: Vec<Record>, meta: &LyricsMeta) -> Option<Lyrics> {
    let target_duration = meta.duration.unwrap_or(0.0);
    let target_artist = meta.artist.as_deref().map(normalize).unwrap_or_default();
    let target_album = meta.album.as_deref().map(normalize).unwrap_or_default();

    let mut candidates = records
        .into_iter()
        .filter(|record| !record.instrumental)
        .filter(|record| record.synced_lyrics.is_some() || record.plain_lyrics.is_some())
        .map(|record| {
            let mut score = 0i32;
            if record.synced_lyrics.is_some() {
                score += 10;
            }
            if !target_artist.is_empty() {
                if normalize(&record.artist_name) == target_artist {
                    score += 4;
                } else if normalize(&record.artist_name).contains(&target_artist) {
                    score += 1;
                } else {
                    score -= 4;
                }
            }
            if !target_album.is_empty() && normalize(&record.album_name) == target_album {
                score += 1;
            }
            let delta = record
                .duration
                .filter(|value| *value > 0.0)
                .map(|value| (value - target_duration).abs())
                .unwrap_or(f64::MAX);
            score += if delta <= 3.0 {
                6
            } else if delta <= 8.0 {
                3
            } else if delta <= 20.0 {
                1
            } else {
                -3
            };
            (score, delta, record)
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
    });

    candidates
        .into_iter()
        .next()
        .and_then(|(_, _, record)| record_to_lyrics(record))
}

fn record_to_lyrics(record: Record) -> Option<Lyrics> {
    if record.instrumental {
        return None;
    }

    let parsed = record
        .synced_lyrics
        .as_deref()
        .map(lyrics::parse)
        .filter(|parsed| parsed.has_synced);
    let synced = parsed.as_ref().and_then(|parsed| parsed.synced.clone());
    let plain = record
        .plain_lyrics
        .filter(|text| !text.trim().is_empty())
        .or_else(|| parsed.as_ref().and_then(|parsed| parsed.plain.clone()));

    if synced.is_none() && plain.is_none() {
        return None;
    }

    Some(Lyrics {
        plain,
        synced,
        title: nonempty(record.track_name),
        artist: nonempty(record.artist_name),
        album: nonempty(record.album_name),
        source: LyricsSource::Lrclib,
    })
}

fn nonempty(value: String) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn normalize(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(json: &str) -> Record {
        serde_json::from_str(json).expect("valid LRCLIB record")
    }

    #[test]
    fn parses_synced_record() {
        let record = record(
            r#"{
                "trackName": "Example",
                "artistName": "Artist",
                "albumName": "Album",
                "duration": 120.0,
                "instrumental": false,
                "plainLyrics": "First line\nSecond line",
                "syncedLyrics": "[00:01.00] First line\n[00:05.50] Second line"
            }"#,
        );
        let lyrics = record_to_lyrics(record).expect("lyrics");
        assert_eq!(lyrics.source, LyricsSource::Lrclib);
        assert_eq!(lyrics.title.as_deref(), Some("Example"));
        let synced = lyrics.synced.expect("synced lines");
        assert_eq!(synced.len(), 2);
        assert_eq!(synced[0].start_ms, 1_000);
        assert_eq!(synced[1].start_ms, 5_500);
        assert_eq!(synced[1].text, "Second line");
    }

    #[test]
    fn ignores_instrumentals() {
        let record = record(
            r#"{
                "trackName": "Example",
                "artistName": "Artist",
                "instrumental": true,
                "plainLyrics": null,
                "syncedLyrics": null
            }"#,
        );
        assert!(record_to_lyrics(record).is_none());
    }

    #[test]
    fn prefers_synced_and_matching_duration() {
        let meta = LyricsMeta {
            title: Some("Example".into()),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            duration: Some(120.0),
        };
        let records = vec![
            record(
                r#"{"trackName":"Example","artistName":"Artist","albumName":"Album",
                    "duration":121.0,"plainLyrics":"line","syncedLyrics":null}"#,
            ),
            record(
                r#"{"trackName":"Example","artistName":"Artist","albumName":"Album",
                    "duration":119.0,"plainLyrics":"line","syncedLyrics":"[00:01.00] line"}"#,
            ),
            record(
                r#"{"trackName":"Example","artistName":"Other","albumName":"Album",
                    "duration":120.0,"plainLyrics":"line","syncedLyrics":"[00:01.00] line"}"#,
            ),
        ];
        let lyrics = pick_best(records, &meta).expect("lyrics");
        assert!(lyrics.synced.is_some());
        assert_eq!(lyrics.artist.as_deref(), Some("Artist"));
    }

    /// Hits the real API. Run with `cargo test lrclib -- --ignored`.
    #[test]
    #[ignore]
    fn fetches_from_lrclib() {
        let client = reqwest::Client::new();
        let lrclib = Lrclib::new(client);
        let meta = LyricsMeta {
            title: Some("Wild".into()),
            artist: Some("Juice WRLD".into()),
            album: Some("Outsiders (Sessions)".into()),
            duration: Some(140.0),
        };
        let lyrics = tauri::async_runtime::block_on(lrclib.lyrics("test-track", &meta));
        let lyrics = lyrics.expect("LRCLIB lyrics");
        assert_eq!(lyrics.source, LyricsSource::Lrclib);
        assert!(lyrics.synced.is_some() || lyrics.plain.is_some());
    }
}
