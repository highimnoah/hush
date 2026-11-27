//! Local LRC storage, parsing and serialization.
//!
//! Navidrome/Subsonic can serve lyrics but has no endpoint for saving them.
//! hush keeps an editable local lyrics layer per track and can export standard
//! `.lrc` files for placement next to the audio file (Navidrome picks those up
//! on its next scan).

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::error::{HushError, Result};
use crate::server::types::{LyricLine, Lyrics, LyricsSource};

/// One editable line. `start_ms` is `None` for plain (untimed) lines.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LrcLine {
    #[serde(default)]
    pub start_ms: Option<u64>,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LrcMeta {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalLyrics {
    pub track_id: String,
    pub text: String,
    #[serde(default)]
    pub plain: Option<String>,
    #[serde(default)]
    pub synced: Option<Vec<LyricLine>>,
    #[serde(default)]
    pub lines: Vec<LrcLine>,
    #[serde(default)]
    pub meta: LrcMeta,
    #[serde(default)]
    pub updated_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalLyricsSummary {
    pub track_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub updated_ms: Option<u64>,
    pub synced: bool,
    pub line_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportedLyrics {
    pub text: String,
    #[serde(default)]
    pub plain: Option<String>,
    #[serde(default)]
    pub lines: Vec<LrcLine>,
    #[serde(default)]
    pub meta: LrcMeta,
}

pub struct ParsedLrc {
    pub lines: Vec<LrcLine>,
    pub meta: LrcMeta,
    pub plain: Option<String>,
    pub synced: Option<Vec<LyricLine>>,
    pub has_synced: bool,
}

pub struct LyricsStore {
    dir: PathBuf,
}

impl LyricsStore {
    pub fn load(base: PathBuf) -> Self {
        let dir = base.join("lyrics");
        let _ = std::fs::create_dir_all(&dir);
        Self { dir }
    }

    fn path_for(&self, track_id: &str) -> PathBuf {
        self.dir
            .join(format!("{}.lrc", hex_encode(track_id.as_bytes())))
    }

    fn track_id_from_path(&self, path: &Path) -> Option<String> {
        let stem = path.file_stem()?.to_str()?;
        let bytes = hex_decode(stem)?;
        String::from_utf8(bytes).ok()
    }

    pub fn get(&self, track_id: &str) -> Option<LocalLyrics> {
        let path = self.path_for(track_id);
        let text = std::fs::read_to_string(&path).ok()?;
        let parsed = parse(&text);
        let updated_ms = std::fs::metadata(&path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);

        Some(LocalLyrics {
            track_id: track_id.to_string(),
            text,
            plain: parsed.plain,
            synced: parsed.synced,
            lines: parsed.lines,
            meta: parsed.meta,
            updated_ms,
        })
    }

    pub fn save(&self, track_id: &str, lines: &[LrcLine], meta: &LrcMeta) -> Result<LocalLyrics> {
        std::fs::create_dir_all(&self.dir)?;
        let text = serialize(lines, meta);
        let path = self.path_for(track_id);
        let tmp = path.with_extension("lrc.tmp");
        std::fs::write(&tmp, &text)?;
        std::fs::rename(&tmp, &path)?;
        self.get(track_id)
            .ok_or_else(|| HushError::Other("Could not read the saved lyrics.".into()))
    }

    pub fn delete(&self, track_id: &str) -> Result<()> {
        match std::fs::remove_file(self.path_for(track_id)) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err.into()),
        }
    }

    pub fn list(&self) -> Vec<LocalLyricsSummary> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return Vec::new();
        };

        let mut out = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| !ext.eq_ignore_ascii_case("lrc"))
                .unwrap_or(true)
            {
                continue;
            }

            let Some(track_id) = self.track_id_from_path(&path) else {
                continue;
            };
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            let parsed = parse(&text);
            let updated_ms = entry
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64);

            out.push(LocalLyricsSummary {
                track_id,
                title: parsed.meta.title,
                artist: parsed.meta.artist,
                album: parsed.meta.album,
                updated_ms,
                synced: parsed.has_synced,
                line_count: parsed.lines.len(),
            });
        }

        out.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
        out
    }
}

pub fn parse(text: &str) -> ParsedLrc {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut meta = LrcMeta::default();
    let mut offset_ms: i64 = 0;
    let mut lines: Vec<LrcLine> = Vec::new();
    let mut plain_lines: Vec<String> = Vec::new();

    for raw in normalized.lines() {
        if raw.trim().is_empty() {
            continue;
        }

        let mut rest = raw;
        let mut times: Vec<u64> = Vec::new();

        // Consume leading `[tag]` groups. Timestamps become line starts;
        // metadata tags update the header; anything else leaves the text intact.
        loop {
            let Some(open) = rest.strip_prefix('[') else {
                break;
            };
            let Some(close) = open.find(']') else {
                break;
            };
            let tag = &open[..close];
            let after = &open[close + 1..];

            if let Some(ms) = parse_timestamp(tag) {
                times.push(ms);
                rest = after;
                continue;
            }

            let Some((key, value)) = tag.split_once(':') else {
                break;
            };

            match key.trim().to_ascii_lowercase().as_str() {
                "ti" => meta.title = nonempty(value),
                "ar" => meta.artist = nonempty(value),
                "al" => meta.album = nonempty(value),
                "offset" => offset_ms = value.trim().parse().unwrap_or(0),
                "length" => {
                    if let Some(ms) = parse_timestamp(value.trim()) {
                        meta.duration_ms = Some(ms);
                    }
                }
                _ => {}
            }
            rest = after;
        }

        let line_text = rest.trim().to_string();

        if times.is_empty() {
            if !line_text.is_empty() {
                lines.push(LrcLine {
                    start_ms: None,
                    text: line_text.clone(),
                });
                plain_lines.push(line_text);
            }
        } else {
            for ms in times {
                let adjusted = (ms as i64 + offset_ms).max(0) as u64;
                lines.push(LrcLine {
                    start_ms: Some(adjusted),
                    text: line_text.clone(),
                });
                plain_lines.push(line_text.clone());
            }
        }
    }

    let mut synced: Vec<LyricLine> = lines
        .iter()
        .filter_map(|line| {
            line.start_ms.map(|start_ms| LyricLine {
                start_ms,
                text: line.text.clone(),
            })
        })
        .collect();
    synced.sort_by_key(|line| line.start_ms);
    let has_synced = !synced.is_empty();

    let plain = if plain_lines.iter().any(|line| !line.is_empty()) {
        Some(plain_lines.join("\n"))
    } else {
        None
    };

    ParsedLrc {
        lines,
        meta,
        plain,
        synced: if has_synced { Some(synced) } else { None },
        has_synced,
    }
}

pub fn serialize(lines: &[LrcLine], meta: &LrcMeta) -> String {
    let mut out = String::new();

    if let Some(value) = meta
        .title
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        out.push_str(&format!("[ti:{value}]\n"));
    }
    if let Some(value) = meta
        .artist
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        out.push_str(&format!("[ar:{value}]\n"));
    }
    if let Some(value) = meta
        .album
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        out.push_str(&format!("[al:{value}]\n"));
    }
    if let Some(duration) = meta.duration_ms {
        out.push_str(&format!("[length:{}]\n", format_timestamp(duration)));
    }
    out.push_str("[by:hush]\n");

    for line in lines {
        if let Some(start_ms) = line.start_ms {
            out.push_str(&format!(
                "[{}] {}\n",
                format_timestamp(start_ms),
                line.text.trim_end()
            ));
        } else if !line.text.trim().is_empty() {
            out.push_str(line.text.trim_end());
            out.push('\n');
        }
    }

    out
}

pub fn to_lyrics(parsed: &ParsedLrc, source: LyricsSource) -> Lyrics {
    Lyrics {
        plain: parsed.plain.clone(),
        synced: parsed.synced.clone(),
        title: parsed.meta.title.clone(),
        artist: parsed.meta.artist.clone(),
        album: parsed.meta.album.clone(),
        source,
    }
}

fn parse_timestamp(value: &str) -> Option<u64> {
    let (minutes, rest) = value.trim().split_once(':')?;
    let minutes: u64 = minutes.trim().parse().ok()?;

    let (seconds, fraction) = if let Some((seconds, fraction)) = rest.split_once('.') {
        (seconds, Some(fraction))
    } else if let Some((seconds, fraction)) = rest.split_once(':') {
        (seconds, Some(fraction))
    } else {
        (rest, None)
    };

    let seconds: u64 = seconds.trim().parse().ok()?;
    let millis = match fraction {
        Some(fraction) => {
            let digits: String = fraction
                .chars()
                .filter(|c| c.is_ascii_digit())
                .take(3)
                .collect();
            match digits.len() {
                0 => 0,
                1 => digits.parse::<u64>().ok()? * 100,
                2 => digits.parse::<u64>().ok()? * 10,
                _ => digits.parse::<u64>().ok()?,
            }
        }
        None => 0,
    };

    Some(minutes * 60_000 + seconds * 1_000 + millis)
}

fn format_timestamp(ms: u64) -> String {
    let minutes = ms / 60_000;
    let seconds = (ms / 1_000) % 60;
    let centis = (ms % 1_000) / 10;
    format!("{minutes:02}:{seconds:02}.{centis:02}")
}

fn nonempty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    use std::fmt::Write as _;

    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

fn hex_decode(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 {
        return None;
    }

    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    let mut index = 0;
    while index < bytes.len() {
        let high = (bytes[index] as char).to_digit(16)?;
        let low = (bytes[index + 1] as char).to_digit(16)?;
        out.push((high * 16 + low) as u8);
        index += 2;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_metadata_synced_and_plain_lines() {
        let parsed = parse(
            "[ti:Song]\n[ar:Artist]\n[al:Album]\n[length:03:07.50]\n\
             [00:01.20]First line\n[00:05.345]Second line\nplain tail\n",
        );

        assert_eq!(parsed.meta.title.as_deref(), Some("Song"));
        assert_eq!(parsed.meta.artist.as_deref(), Some("Artist"));
        assert_eq!(parsed.meta.album.as_deref(), Some("Album"));
        assert_eq!(parsed.meta.duration_ms, Some(187_500));
        assert_eq!(parsed.lines.len(), 3);
        assert_eq!(parsed.lines[0].start_ms, Some(1_200));
        assert_eq!(parsed.lines[1].start_ms, Some(5_345));
        assert_eq!(parsed.lines[2].start_ms, None);
        assert_eq!(parsed.lines[2].text, "plain tail");
        assert!(parsed.has_synced);
        assert_eq!(parsed.synced.as_ref().map(Vec::len), Some(2));
    }

    #[test]
    fn applies_offset_and_multiple_timestamps() {
        let parsed = parse("[offset:-500]\n[00:02.00][00:10.00]Repeated\n");
        let synced = parsed.synced.expect("synced lines");
        assert_eq!(synced.len(), 2);
        assert_eq!(synced[0].start_ms, 1_500);
        assert_eq!(synced[1].start_ms, 9_500);
    }

    #[test]
    fn serializes_and_round_trips() {
        let lines = vec![
            LrcLine {
                start_ms: Some(1_230),
                text: "Hello".into(),
            },
            LrcLine {
                start_ms: Some(65_500),
                text: "World".into(),
            },
        ];
        let meta = LrcMeta {
            title: Some("Song".into()),
            artist: Some("Artist".into()),
            album: None,
            duration_ms: Some(180_000),
        };

        let text = serialize(&lines, &meta);
        assert!(text.contains("[ti:Song]"));
        assert!(text.contains("[00:01.23] Hello"));
        assert!(text.contains("[01:05.50] World"));

        let parsed = parse(&text);
        assert_eq!(parsed.lines.len(), 2);
        assert_eq!(parsed.lines[0].start_ms, Some(1_230));
        assert_eq!(parsed.lines[1].start_ms, Some(65_500));
        assert_eq!(parsed.meta.duration_ms, Some(180_000));
    }

    #[test]
    fn store_saves_lists_and_deletes() {
        let base = std::env::temp_dir().join(format!(
            "hush-lyrics-test-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        let store = LyricsStore::load(base.clone());

        let lines = vec![
            LrcLine {
                start_ms: Some(1000),
                text: "One".into(),
            },
            LrcLine {
                start_ms: Some(2000),
                text: "Two".into(),
            },
        ];
        let meta = LrcMeta {
            title: Some("Stored song".into()),
            artist: None,
            album: None,
            duration_ms: None,
        };

        let saved = store
            .save("track/with odd:id", &lines, &meta)
            .expect("save");
        assert_eq!(saved.synced.as_ref().map(Vec::len), Some(2));

        let listed = store.list();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].track_id, "track/with odd:id");
        assert!(listed[0].synced);

        store.delete("track/with odd:id").expect("delete");
        assert!(store.get("track/with odd:id").is_none());
        assert!(store.list().is_empty());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn hex_round_trips_track_ids() {
        let encoded = hex_encode(b"al-123/with:odd*chars");
        assert!(encoded.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            hex_decode(&encoded).as_deref(),
            Some(&b"al-123/with:odd*chars"[..])
        );
    }
}
