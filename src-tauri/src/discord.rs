use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

use crate::config::Settings;

#[derive(Clone, Debug, Default)]
pub struct DiscordConfig {
    pub enabled: bool,
    pub client_id: String,
    pub details: String,
    pub state: String,
    pub large_image: String,
    pub timestamps: bool,
    pub use_cover: bool,
}

impl From<&Settings> for DiscordConfig {
    fn from(settings: &Settings) -> Self {
        Self {
            enabled: settings.discord_enabled,
            client_id: settings.discord_client_id.trim().to_string(),
            details: settings.discord_details.clone(),
            state: settings.discord_state.clone(),
            large_image: settings.discord_large_image.clone(),
            timestamps: settings.discord_timestamps,
            use_cover: settings.discord_use_cover,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct PresenceData {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub server: String,
    pub format: String,
    pub bitrate: Option<u32>,
    pub cover_url: Option<String>,
    pub elapsed: u64,
    pub duration: u64,
}

enum DiscordCommand {
    Configure(DiscordConfig),
    SetPresence(PresenceData),
    Clear,
}

#[derive(Clone)]
pub struct DiscordHandle {
    tx: Sender<DiscordCommand>,
}

impl DiscordHandle {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel();
        let _ = std::thread::Builder::new()
            .name("hush-discord".to_string())
            .spawn(move || run(rx));
        Self { tx }
    }

    pub fn configure(&self, config: DiscordConfig) {
        let _ = self.tx.send(DiscordCommand::Configure(config));
    }

    pub fn set_presence(&self, data: PresenceData) {
        let _ = self.tx.send(DiscordCommand::SetPresence(data));
    }

    pub fn clear(&self) {
        let _ = self.tx.send(DiscordCommand::Clear);
    }
}

struct ClientState {
    config: DiscordConfig,
    client: Option<DiscordIpcClient>,
    presence: Option<PresenceData>,
    last_attempt: Option<Instant>,
}

fn run(rx: Receiver<DiscordCommand>) {
    let mut state = ClientState {
        config: DiscordConfig::default(),
        client: None,
        presence: None,
        last_attempt: None,
    };

    loop {
        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok(DiscordCommand::Configure(config)) => {
                state.config = config;
                sync(&mut state);
            }
            Ok(DiscordCommand::SetPresence(data)) => {
                state.presence = Some(data);
                sync(&mut state);
            }
            Ok(DiscordCommand::Clear) => {
                state.presence = None;
                sync(&mut state);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => sync(&mut state),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    if let Some(mut client) = state.client.take() {
        let _ = client.clear_activity();
        let _ = client.close();
    }
}

fn sync(state: &mut ClientState) {
    let wants_presence = state.config.enabled && state.presence.is_some();

    if !wants_presence {
        if let Some(mut client) = state.client.take() {
            let _ = client.clear_activity();
            let _ = client.close();
        }
        return;
    }

    if !ensure_client(state) {
        return;
    }

    let Some(presence) = state.presence.as_ref() else {
        return;
    };
    let activity = build_activity(&state.config, presence);

    let failed = match state.client.as_mut() {
        Some(client) => client.set_activity(activity).is_err(),
        None => true,
    };

    if failed {
        if let Some(mut client) = state.client.take() {
            let _ = client.close();
        }
    }
}

fn ensure_client(state: &mut ClientState) -> bool {
    if state.client.is_some() {
        return true;
    }
    if state.config.client_id.is_empty() {
        return false;
    }

    // Throttle reconnect attempts so a closed Discord client doesn't cause a
    // busy loop.
    if let Some(last) = state.last_attempt {
        if last.elapsed() < Duration::from_secs(5) {
            return false;
        }
    }
    state.last_attempt = Some(Instant::now());

    let mut client = DiscordIpcClient::new(state.config.client_id.clone());
    if client.connect().is_ok() {
        state.client = Some(client);
        true
    } else {
        false
    }
}

fn build_activity(config: &DiscordConfig, data: &PresenceData) -> activity::Activity<'static> {
    let details = render(&config.details, data);
    let state = render(&config.state, data);

    let mut activity = activity::Activity::new().activity_type(activity::ActivityType::Listening);

    if !details.trim().is_empty() {
        activity = activity.details(details);
    }
    if !state.trim().is_empty() {
        activity = activity.state(state);
    }

    // Prefer the live cover URL (public HTTPS only) when enabled; otherwise
    // fall back to the configured static asset key.
    let cover = if config.use_cover {
        data.cover_url
            .as_deref()
            .filter(|url| url.starts_with("https://"))
            .map(|url| url.to_string())
    } else {
        None
    };
    let large_image = cover.unwrap_or_else(|| config.large_image.clone());

    if !large_image.trim().is_empty() {
        let large_text = if data.album.trim().is_empty() {
            if data.title.trim().is_empty() {
                "hush".to_string()
            } else {
                data.title.clone()
            }
        } else {
            data.album.clone()
        };
        activity = activity.assets(
            activity::Assets::new()
                .large_image(large_image)
                .large_text(large_text),
        );
    }

    // A start *and* end timestamp makes Discord render a progress timeline.
    if config.timestamps && data.duration > 0 {
        let now = unix_now();
        let elapsed = data.elapsed.min(data.duration) as i64;
        let start = now - elapsed;
        let end = start + data.duration as i64;
        activity = activity.timestamps(activity::Timestamps::new().start(start).end(end));
    }

    activity
}

fn render(template: &str, data: &PresenceData) -> String {
    let bitrate = data
        .bitrate
        .map(|rate| format!("{rate} kbps"))
        .unwrap_or_default();

    let replacements = [
        ("{app}", "hush".to_string()),
        ("{title}", data.title.clone()),
        ("{artist}", data.artist.clone()),
        ("{albumArtist}", data.album_artist.clone()),
        ("{albumartist}", data.album_artist.clone()),
        ("{album}", data.album.clone()),
        ("{server}", data.server.clone()),
        ("{format}", data.format.clone()),
        ("{bitrate}", bitrate),
        ("{elapsed}", format_time(data.elapsed)),
        ("{duration}", format_time(data.duration)),
    ];

    let mut output = template.to_string();
    for (token, value) in replacements {
        output = output.replace(token, &value);
    }

    // Discord caps details/state at 128 characters.
    output.chars().take(128).collect()
}

fn format_time(total_seconds: u64) -> String {
    let seconds = total_seconds % 60;
    let minutes = (total_seconds / 60) % 60;
    let hours = total_seconds / 3600;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}
