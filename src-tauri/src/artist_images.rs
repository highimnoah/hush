//! Automatic artist artwork with an on-disk cache.
//!
//! Provider chain: a server-provided `artistImageUrl` is used directly by the
//! frontend. When the server has no image (or the user only wants server
//! images), this module can look up missing artists on Deezer and fall back to
//! the iTunes Search API. Downloads happen here in Rust and are cached in the
//! app cache directory; the WebView loads them through the `hushimg://`
//! protocol so no remote origin is involved.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, Semaphore};

use crate::config::ArtistImageMode;

const NEGATIVE_TTL_SECS: u64 = 7 * 24 * 60 * 60;
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(8);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_CONCURRENT_FETCHES: usize = 4;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistImageInfo {
    pub source: String,
    pub url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub bytes: u64,
    pub count: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheEntry {
    /// File name in the cache directory, or `None` for a negative cache entry.
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    fetched_at: u64,
}

enum Lookup {
    Hit(ArtistImageInfo),
    Negative,
    Miss,
}

/// Disk-backed artist image cache and provider chain. Cheap to clone.
#[derive(Clone)]
pub struct ArtistImageStore {
    dir: PathBuf,
    http: reqwest::Client,
    index: Arc<StdMutex<HashMap<String, CacheEntry>>>,
    inflight: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    slots: Arc<Semaphore>,
}

impl ArtistImageStore {
    pub fn new(dir: PathBuf, http: reqwest::Client) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        let index = std::fs::read_to_string(dir.join("index.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<HashMap<String, CacheEntry>>(&raw).ok())
            .unwrap_or_default();
        Self {
            dir,
            http,
            index: Arc::new(StdMutex::new(index)),
            inflight: Arc::new(Mutex::new(HashMap::new())),
            slots: Arc::new(Semaphore::new(MAX_CONCURRENT_FETCHES)),
        }
    }

    /// Resolve artwork for an artist. The server URL wins when present; with
    /// `ArtistImageMode::Auto` missing images are fetched and cached.
    pub async fn resolve(
        &self,
        name: &str,
        server_url: Option<String>,
        mode: ArtistImageMode,
    ) -> Option<ArtistImageInfo> {
        if mode == ArtistImageMode::Off {
            return None;
        }

        if let Some(url) = server_url {
            let url = url.trim();
            if !url.is_empty() {
                return Some(ArtistImageInfo {
                    source: "server".to_string(),
                    url: url.to_string(),
                });
            }
        }

        if mode != ArtistImageMode::Auto {
            return None;
        }

        let key = normalize(name);
        if key.is_empty() {
            return None;
        }

        match self.lookup(&key) {
            Lookup::Hit(info) => return Some(info),
            Lookup::Negative => return None,
            Lookup::Miss => {}
        }

        // Serialize fetches for the same artist name.
        let gate = {
            let mut map = self.inflight.lock().await;
            map.entry(key.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _guard = gate.lock().await;

        match self.lookup(&key) {
            Lookup::Hit(info) => {
                self.release(&key).await;
                return Some(info);
            }
            Lookup::Negative => {
                self.release(&key).await;
                return None;
            }
            Lookup::Miss => {}
        }

        let result = self.fetch_and_store(&key, name).await;
        self.release(&key).await;
        result
    }

    /// Current cache usage (image files only).
    pub fn info(&self) -> CacheInfo {
        let mut bytes = 0;
        let mut count = 0;
        if let Ok(entries) = std::fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if is_image_path(&path) {
                    if let Ok(meta) = entry.metadata() {
                        bytes += meta.len();
                        count += 1;
                    }
                }
            }
        }
        CacheInfo { bytes, count }
    }

    /// Delete cached images and the index. Returns the previous usage.
    pub fn clear(&self) -> CacheInfo {
        let before = self.info();
        if let Ok(entries) = std::fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if is_image_path(&path) {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
        if let Ok(mut index) = self.index.lock() {
            index.clear();
            self.write_index(&index);
        }
        before
    }

    /// Read a cached image for the `hushimg://` protocol handler.
    pub fn read_cached(&self, file: &str) -> Option<(Vec<u8>, &'static str)> {
        if !valid_filename(file) {
            return None;
        }
        let data = std::fs::read(self.dir.join(file)).ok()?;
        let content_type = match Path::new(file).extension().and_then(|ext| ext.to_str()) {
            Some("png") => "image/png",
            Some("webp") => "image/webp",
            _ => "image/jpeg",
        };
        Some((data, content_type))
    }

    fn lookup(&self, key: &str) -> Lookup {
        let Ok(index) = self.index.lock() else {
            return Lookup::Miss;
        };
        let Some(entry) = index.get(key) else {
            return Lookup::Miss;
        };
        match &entry.file {
            Some(file) if self.dir.join(file).is_file() => Lookup::Hit(ArtistImageInfo {
                source: entry.source.clone().unwrap_or_else(|| "cache".to_string()),
                url: Self::url_for(file),
            }),
            Some(_) => Lookup::Miss,
            None => {
                if now_secs().saturating_sub(entry.fetched_at) < NEGATIVE_TTL_SECS {
                    Lookup::Negative
                } else {
                    Lookup::Miss
                }
            }
        }
    }

    async fn release(&self, key: &str) {
        self.inflight.lock().await.remove(key);
    }

    async fn fetch_and_store(&self, key: &str, name: &str) -> Option<ArtistImageInfo> {
        let Ok(_permit) = self.slots.acquire().await else {
            return None;
        };

        if let Some(url) = deezer_lookup(&self.http, name).await {
            if let Some(info) = self.store_image(key, "deezer", &url).await {
                return Some(info);
            }
        }
        if let Some(url) = itunes_lookup(&self.http, name).await {
            if let Some(info) = self.store_image(key, "itunes", &url).await {
                return Some(info);
            }
        }

        self.record(key, None, None);
        None
    }

    async fn store_image(
        &self,
        key: &str,
        source: &str,
        url: &str,
    ) -> Option<ArtistImageInfo> {
        let (bytes, ext) = download_image(&self.http, url).await?;
        let file = format!("{}.{}", fnv_hex(key), ext);
        std::fs::write(self.dir.join(&file), bytes).ok()?;
        self.record(key, Some(file.clone()), Some(source));
        Some(ArtistImageInfo {
            source: source.to_string(),
            url: Self::url_for(&file),
        })
    }

    fn record(&self, key: &str, file: Option<String>, source: Option<&str>) {
        let Ok(mut index) = self.index.lock() else {
            return;
        };
        index.insert(
            key.to_string(),
            CacheEntry {
                file,
                source: source.map(str::to_string),
                fetched_at: now_secs(),
            },
        );
        self.write_index(&index);
    }

    fn write_index(&self, index: &HashMap<String, CacheEntry>) {
        let Ok(json) = serde_json::to_string(index) else {
            return;
        };
        let tmp = self.dir.join("index.json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, self.dir.join("index.json"));
        }
    }

    fn url_for(file: &str) -> String {
        if cfg!(windows) {
            format!("http://hushimg.localhost/{file}")
        } else {
            format!("hushimg://localhost/{file}")
        }
    }
}

fn normalize(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn names_match(query: &str, candidate: &str) -> bool {
    let query = normalize(query);
    let candidate = normalize(candidate);
    if query.is_empty() || candidate.is_empty() {
        return false;
    }
    if query == candidate {
        return true;
    }
    let shortest = query.len().min(candidate.len());
    shortest >= 4 && (query.contains(&candidate) || candidate.contains(&query))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Stable 64-bit FNV-1a hash, used only for cache file names.
fn fnv_hex(value: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in value.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn is_image_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|ext| ext.to_str()),
        Some("jpg" | "jpeg" | "png" | "webp")
    )
}

fn valid_filename(name: &str) -> bool {
    let mut parts = name.split('.');
    let Some(stem) = parts.next() else {
        return false;
    };
    let Some(ext) = parts.next() else {
        return false;
    };
    parts.next().is_none()
        && stem.len() == 16
        && stem.bytes().all(|byte| byte.is_ascii_hexdigit())
        && matches!(ext, "jpg" | "jpeg" | "png" | "webp")
}

async fn deezer_lookup(http: &reqwest::Client, name: &str) -> Option<String> {
    let response = http
        .get("https://api.deezer.com/search/artist")
        .query(&[("q", name), ("limit", "5")])
        .timeout(LOOKUP_TIMEOUT)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let value: serde_json::Value = response.json().await.ok()?;
    let items = value.get("data")?.as_array()?;
    for item in items {
        let candidate = item.get("name").and_then(|value| value.as_str()).unwrap_or("");
        if !names_match(name, candidate) {
            continue;
        }
        for field in ["picture_xl", "picture_big", "picture_medium", "picture"] {
            if let Some(url) = item.get(field).and_then(|value| value.as_str()) {
                if url.starts_with("https://") {
                    return Some(url.to_string());
                }
            }
        }
    }
    None
}

async fn itunes_lookup(http: &reqwest::Client, name: &str) -> Option<String> {
    let response = http
        .get("https://itunes.apple.com/search")
        .query(&[
            ("term", name),
            ("entity", "album"),
            ("attribute", "artistTerm"),
            ("limit", "5"),
        ])
        .timeout(LOOKUP_TIMEOUT)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let value: serde_json::Value = response.json().await.ok()?;
    let items = value.get("results")?.as_array()?;
    for item in items {
        let candidate = item
            .get("artistName")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if !names_match(name, candidate) {
            continue;
        }
        if let Some(url) = item.get("artworkUrl100").and_then(|value| value.as_str()) {
            let big = url.replace("100x100bb", "600x600bb");
            if big.starts_with("https://") {
                return Some(big);
            }
        }
    }
    None
}

async fn download_image(http: &reqwest::Client, url: &str) -> Option<(Vec<u8>, String)> {
    let response = http
        .get(url)
        .timeout(DOWNLOAD_TIMEOUT)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    if response.content_length().unwrap_or(0) as usize > MAX_IMAGE_BYTES {
        return None;
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !content_type.starts_with("image/") {
        return None;
    }
    let bytes = response.bytes().await.ok()?.to_vec();
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let ext = match content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };
    Some((bytes, ext.to_string()))
}
