use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use hush_session_protocol::{
    ClientMessage, Member, ServerMessage, SessionState, SessionTrack, CODE_LEN, PROTOCOL_VERSION,
};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Listener};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::Message;

use super::{SessionCommand, SessionRole, SessionSnapshot, SyncStatus};
use crate::config::{ConfigStore, Settings};
use crate::player::{Command, PlaybackStatus, PlayerHandle, PlayerSnapshot};

static CLOCK: OnceLock<Instant> = OnceLock::new();

fn now_secs() -> f64 {
    CLOCK.get_or_init(Instant::now).elapsed().as_secs_f64()
}

fn display_name(settings: &Settings) -> String {
    let name = settings.session_name.trim();
    if !name.is_empty() {
        return name.to_string();
    }
    let user = settings.username.trim();
    if !user.is_empty() {
        user.to_string()
    } else {
        "Listener".to_string()
    }
}

fn relay_url(settings: &Settings) -> String {
    let raw = settings.session_relay_url.trim();
    let url = if raw.is_empty() {
        "ws://127.0.0.1:8787"
    } else {
        raw
    };
    if let Some(rest) = url.strip_prefix("http://") {
        format!("ws://{rest}")
    } else if let Some(rest) = url.strip_prefix("https://") {
        format!("wss://{rest}")
    } else {
        url.to_string()
    }
}

#[derive(Clone, Default)]
struct LocalPlayback {
    track: Option<SessionTrack>,
    position: f64,
    playing: bool,
    updated_at: f64,
}

enum ConnectionEvent {
    Connected(u64),
    Message(u64, ServerMessage),
    Closed(u64, String),
}

struct Controller {
    app: AppHandle,
    player: PlayerHandle,
    config: Arc<ConfigStore>,
    http: reqwest::Client,
    snapshot: Arc<Mutex<SessionSnapshot>>,
    local: Arc<Mutex<LocalPlayback>>,
    local_notify: Arc<Notify>,
    events_tx: UnboundedSender<ConnectionEvent>,

    connection: Option<UnboundedSender<ClientMessage>>,
    generation: u64,
    pending_role: Option<SessionRole>,
    my_id: Option<String>,
    name: String,
    role: SessionRole,
    code: Option<String>,
    host_id: Option<String>,
    members: Vec<Member>,
    connected: bool,
    sync: SyncStatus,
    drift_ms: Option<f64>,
    error: Option<String>,

    offset: Option<f64>,
    sync_counter: u64,
    pending_sync: HashMap<u64, f64>,
    last_host_state: Option<SessionState>,
    last_state_sent: Instant,
    last_seek_at: Instant,
    settle_until: Instant,
    loading_track: Option<(String, Instant)>,
}

pub async fn run(
    app: AppHandle,
    player: PlayerHandle,
    config: Arc<ConfigStore>,
    http: reqwest::Client,
    mut commands: UnboundedReceiver<SessionCommand>,
    snapshot: Arc<Mutex<SessionSnapshot>>,
) {
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let local = Arc::new(Mutex::new(LocalPlayback::default()));
    let local_notify = Arc::new(Notify::new());

    install_listeners(&app, local.clone(), local_notify.clone());

    let settings = config.get();
    let mut controller = Controller {
        app,
        player,
        config,
        http,
        snapshot,
        local,
        local_notify: local_notify.clone(),
        events_tx,
        connection: None,
        generation: 0,
        pending_role: None,
        my_id: None,
        name: display_name(&settings),
        role: SessionRole::None,
        code: None,
        host_id: None,
        members: Vec::new(),
        connected: false,
        sync: SyncStatus::Idle,
        drift_ms: None,
        error: None,
        offset: None,
        sync_counter: 0,
        pending_sync: HashMap::new(),
        last_host_state: None,
        last_state_sent: Instant::now() - Duration::from_secs(1),
        last_seek_at: Instant::now() - Duration::from_secs(1),
        settle_until: Instant::now() - Duration::from_secs(1),
        loading_track: None,
    };
    controller.publish();

    let mut host_tick = tokio::time::interval(Duration::from_millis(300));
    let mut drift_tick = tokio::time::interval(Duration::from_secs(1));
    let mut sync_tick = tokio::time::interval(Duration::from_secs(10));
    host_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    drift_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    sync_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            command = commands.recv() => {
                match command {
                    Some(SessionCommand::Create) => controller.create(),
                    Some(SessionCommand::Join { code }) => controller.join(code),
                    Some(SessionCommand::Leave) => controller.leave(),
                    None => break,
                }
            }
            event = events_rx.recv() => {
                if let Some(event) = event {
                    controller.handle_event(event);
                }
            }
            _ = local_notify.notified() => controller.on_local_change(),
            _ = host_tick.tick() => controller.on_host_tick(),
            _ = drift_tick.tick() => controller.on_drift_tick(),
            _ = sync_tick.tick() => controller.on_sync_tick(),
        }
    }

    controller.leave();
}

impl Controller {
    fn create(&mut self) {
        if self.role != SessionRole::None {
            return;
        }

        let settings = self.config.get();
        self.name = display_name(&settings);
        self.error = None;
        self.connected = false;
        self.pending_role = Some(SessionRole::Host);

        self.start_connection(
            relay_url(&settings),
            vec![
                ClientMessage::Hello {
                    name: self.name.clone(),
                    protocol: PROTOCOL_VERSION,
                },
                ClientMessage::Create,
            ],
        );
        self.publish();
    }

    fn join(&mut self, code: String) {
        if self.role != SessionRole::None {
            return;
        }

        let code = code.trim().to_uppercase();
        if code.chars().count() != CODE_LEN {
            self.error = Some(format!("Enter a {CODE_LEN}-character session code."));
            self.publish();
            return;
        }

        let settings = self.config.get();
        self.name = display_name(&settings);
        self.error = None;
        self.connected = false;
        self.pending_role = Some(SessionRole::Guest);

        self.start_connection(
            relay_url(&settings),
            vec![
                ClientMessage::Hello {
                    name: self.name.clone(),
                    protocol: PROTOCOL_VERSION,
                },
                ClientMessage::Join { code },
            ],
        );
        self.publish();
    }

    fn leave(&mut self) {
        if let Some(tx) = self.connection.take() {
            let _ = tx.send(ClientMessage::Leave);
        }
        self.generation = self.generation.wrapping_add(1);
        self.pending_role = None;
        self.my_id = None;
        self.role = SessionRole::None;
        self.code = None;
        self.host_id = None;
        self.members.clear();
        self.connected = false;
        self.sync = SyncStatus::Idle;
        self.drift_ms = None;
        self.error = None;
        self.offset = None;
        self.last_host_state = None;
        self.loading_track = None;
        self.publish();
    }

    fn start_connection(&mut self, url: String, initial: Vec<ClientMessage>) {
        self.connection = None;
        self.generation = self.generation.wrapping_add(1);
        let generation = self.generation;
        let (outbound_tx, outbound_rx) = tokio::sync::mpsc::unbounded_channel();
        self.connection = Some(outbound_tx);
        let events = self.events_tx.clone();

        tokio::spawn(async move {
            connection_task(url, initial, outbound_rx, events, generation).await;
        });
    }

    fn handle_event(&mut self, event: ConnectionEvent) {
        match event {
            ConnectionEvent::Connected(generation) => {
                if generation != self.generation {
                    return;
                }
                self.connected = true;
                self.publish();
            }
            ConnectionEvent::Message(generation, message) => {
                if generation != self.generation {
                    return;
                }
                self.handle_message(message);
            }
            ConnectionEvent::Closed(generation, reason) => {
                if generation != self.generation {
                    return;
                }
                self.connection = None;
                self.pending_role = None;
                self.role = SessionRole::None;
                self.code = None;
                self.host_id = None;
                self.members.clear();
                self.connected = false;
                self.sync = SyncStatus::Disconnected;
                self.last_host_state = None;
                self.offset = None;
                self.loading_track = None;
                self.error = Some(reason);
                self.publish();
            }
        }
    }

    fn handle_message(&mut self, message: ServerMessage) {
        match message {
            ServerMessage::Welcome { id } => {
                self.my_id = Some(id);
            }
            ServerMessage::Created { code } => {
                if self.pending_role != Some(SessionRole::Host) {
                    return;
                }
                self.role = SessionRole::Host;
                self.code = Some(code);
                self.host_id = self.my_id.clone();
                self.connected = true;
                self.sync = SyncStatus::Synced;
                self.error = None;
                self.publish();
                self.local_notify.notify_one();
            }
            ServerMessage::Joined {
                code,
                host_id,
                members,
            } => {
                self.code = Some(code);
                self.host_id = Some(host_id);
                self.members = members;
                self.connected = true;
                if self.pending_role == Some(SessionRole::Host) {
                    self.role = SessionRole::Host;
                    self.sync = SyncStatus::Synced;
                } else {
                    self.role = SessionRole::Guest;
                    self.sync = SyncStatus::Idle;
                }
                self.pending_role = None;
                self.error = None;
                self.publish();
                if self.role == SessionRole::Guest {
                    self.send_sync_req();
                } else {
                    self.local_notify.notify_one();
                }
            }
            ServerMessage::MemberJoined { member } => {
                self.members.retain(|existing| existing.id != member.id);
                self.members.push(member);
                self.publish();
                if self.role == SessionRole::Host {
                    self.local_notify.notify_one();
                }
            }
            ServerMessage::MemberLeft { id } => {
                self.members.retain(|member| member.id != id);
                self.publish();
            }
            ServerMessage::HostChanged { host_id } => {
                self.host_id = Some(host_id.clone());
                for member in &mut self.members {
                    member.is_host = member.id == host_id;
                }
                self.role = if self.my_id.as_deref() == Some(host_id.as_str()) {
                    SessionRole::Host
                } else {
                    SessionRole::Guest
                };
                self.sync = if self.role == SessionRole::Host {
                    SyncStatus::Synced
                } else {
                    SyncStatus::Idle
                };
                self.publish();
                if self.role == SessionRole::Host {
                    self.local_notify.notify_one();
                } else {
                    self.send_sync_req();
                }
            }
            ServerMessage::State { state } => {
                if self.role != SessionRole::Guest {
                    return;
                }
                let changed = self
                    .last_host_state
                    .as_ref()
                    .map(|previous| {
                        previous.track.as_ref().map(|track| &track.id)
                            != state.track.as_ref().map(|track| &track.id)
                            || previous.playing != state.playing
                    })
                    .unwrap_or(true);
                self.last_host_state = Some(state.clone());
                self.apply_guest_state(&state);
                if changed {
                    self.publish();
                }
            }
            ServerMessage::SyncReq { from, nonce, t0 } => {
                if self.role != SessionRole::Host {
                    return;
                }
                let _ = t0;
                let now = now_secs();
                self.send(ClientMessage::SyncResp {
                    to: from,
                    nonce,
                    t1: now,
                    t2: now,
                });
            }
            ServerMessage::SyncResp { nonce, t1, t2 } => {
                let Some(t0) = self.pending_sync.remove(&nonce) else {
                    return;
                };
                let t3 = now_secs();
                let offset = ((t1 - t0) + (t2 - t3)) / 2.0;
                self.offset = Some(match self.offset {
                    Some(existing) => existing * 0.7 + offset * 0.3,
                    None => offset,
                });
            }
            ServerMessage::Error { message } => {
                self.error = Some(message);
                self.publish();
            }
        }
    }

    fn apply_guest_state(&mut self, state: &SessionState) {
        let local = self.local.lock().map(|guard| guard.clone()).unwrap_or_default();

        let Some(track) = state.track.clone() else {
            self.player.send(Command::Stop);
            self.loading_track = None;
            return;
        };

        let same_track = local
            .track
            .as_ref()
            .map(|current| current.id == track.id)
            .unwrap_or(false);

        if !same_track {
            if let Some((loading, since)) = &self.loading_track {
                if *loading == track.id && since.elapsed() < Duration::from_secs(8) {
                    return;
                }
            }

            self.loading_track = Some((track.id.clone(), Instant::now()));
            let info = crate::player::TrackInfo {
                id: track.id.clone(),
                title: track.title.clone(),
                artist: non_empty(track.artist.clone()),
                album: non_empty(track.album.clone()),
                album_artist: None,
                cover_art: track.cover_art.clone(),
                cover_url: None,
                server: None,
                duration: Some(track.duration.max(0.0).round() as u32),
                format: None,
                bit_rate: None,
                bit_depth: None,
                sampling_rate: None,
                channel_count: None,
                explicit_status: None,
            };

            let settings = self.config.get();
            if let Err(err) =
                crate::playback::load_track(&self.player, &settings, &self.http, info, 0.0)
            {
                self.error = Some(err.to_string());
                self.loading_track = None;
                self.publish();
                return;
            }

            if state.position > 0.5 {
                self.player.send(Command::Seek(state.position + 0.5));
                self.last_seek_at = Instant::now();
                self.settle_until = Instant::now() + Duration::from_secs(2);
            }
            if !state.playing {
                self.player.send(Command::Pause);
            }
            return;
        }

        if state.playing && !local.playing {
            self.player.send(Command::Play);
        } else if !state.playing && local.playing {
            self.player.send(Command::Pause);
        }

        if state.playing {
            self.correct_drift(state, &local);
        }
    }

    fn correct_drift(&mut self, state: &SessionState, local: &LocalPlayback) {
        let Some(offset) = self.offset else {
            return;
        };
        if local.updated_at <= 0.0 {
            return;
        }

        let now = now_secs();
        let sample_guest_time = state.host_clock - offset;

        // Compare the local position against the host position at the *time the
        // local sample was taken*, not "now". Position events arrive every
        // ~300 ms, so using `now` would invent a few hundred ms of fake drift.
        let expected_at_sample = if state.playing {
            (state.position + (local.updated_at - sample_guest_time)).max(0.0)
        } else {
            state.position
        };
        if Instant::now() < self.settle_until {
            return;
        }

        let drift = local.position - expected_at_sample;
        let magnitude = drift.abs();

        if magnitude > 2.5 {
            let expected_now = if state.playing {
                (state.position + (now - sample_guest_time)).max(0.0)
            } else {
                state.position
            };
            if self.last_seek_at.elapsed() > Duration::from_millis(1000) {
                let target = (expected_now + 0.5).max(0.0);
                self.player.send(Command::Seek(target));
                self.last_seek_at = Instant::now();
                self.settle_until = Instant::now() + Duration::from_secs(2);
            }
            self.set_sync(SyncStatus::Drifting, Some(drift * 1000.0));
        } else {
            self.set_sync(SyncStatus::Synced, Some(drift * 1000.0));
        }
    }

    fn on_local_change(&mut self) {
        if let Some((loading, _)) = &self.loading_track {
            let matched = self
                .local
                .lock()
                .map(|guard| {
                    guard
                        .track
                        .as_ref()
                        .map(|track| track.id == *loading)
                        .unwrap_or(false)
                })
                .unwrap_or(false);
            if matched {
                self.loading_track = None;
            }
        }

        if self.role == SessionRole::Host {
            self.maybe_send_state(true);
            self.publish();
        }
    }

    fn on_host_tick(&mut self) {
        if self.role == SessionRole::Host && self.connected {
            self.maybe_send_state(false);
        }
    }

    fn on_drift_tick(&mut self) {
        if self.role != SessionRole::Guest
            || !self.connected
            || self.loading_track.is_some()
            || Instant::now() < self.settle_until
        {
            return;
        }
        let Some(state) = self.last_host_state.clone() else {
            return;
        };
        if !state.playing {
            return;
        }
        let local_position = self.local.lock().map(|guard| guard.clone()).unwrap_or_default();
        self.correct_drift(&state, &local_position);
    }

    fn on_sync_tick(&mut self) {
        if self.role == SessionRole::Guest && self.connected {
            self.send_sync_req();
        }
    }

    fn send_sync_req(&mut self) {
        if self.role != SessionRole::Guest || !self.connected {
            return;
        }
        self.sync_counter = self.sync_counter.wrapping_add(1);
        let nonce = self.sync_counter;
        let t0 = now_secs();
        if self.pending_sync.len() >= 8 {
            self.pending_sync.clear();
        }
        self.pending_sync.insert(nonce, t0);
        self.send(ClientMessage::SyncReq { nonce, t0 });
    }

    fn maybe_send_state(&mut self, force: bool) {
        if self.role != SessionRole::Host || !self.connected {
            return;
        }
        let now = Instant::now();
        if !force && now.duration_since(self.last_state_sent) < Duration::from_millis(100) {
            return;
        }

        let local = match self.local.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => return,
        };

        if !force && (!local.playing || local.track.is_none()) {
            return;
        }

        self.last_state_sent = now;
        self.send(ClientMessage::State {
            state: SessionState {
                track: local.track,
                position: local.position,
                playing: local.playing,
                host_clock: now_secs(),
            },
        });
    }

    fn set_sync(&mut self, status: SyncStatus, drift_ms: Option<f64>) {
        let changed = self.sync != status
            || self
                .drift_ms
                .map(|previous| {
                    (previous - drift_ms.unwrap_or(previous)).abs() > 80.0
                })
                .unwrap_or(true);
        self.sync = status;
        self.drift_ms = drift_ms;
        if changed {
            self.publish();
        }
    }

    fn send(&self, message: ClientMessage) {
        if let Some(connection) = &self.connection {
            let _ = connection.send(message);
        }
    }

    fn snapshot_value(&self) -> SessionSnapshot {
        let settings = self.config.get();
        let (now_playing, playing) = if self.role == SessionRole::Guest {
            match &self.last_host_state {
                Some(state) => (state.track.clone(), state.playing),
                None => (None, false),
            }
        } else {
            match self.local.lock() {
                Ok(guard) => (guard.track.clone(), guard.playing),
                Err(_) => (None, false),
            }
        };

        SessionSnapshot {
            role: self.role,
            code: self.code.clone(),
            name: self.name.clone(),
            relay_url: relay_url(&settings),
            host_id: self.host_id.clone(),
            members: self.members.clone(),
            connected: self.connected,
            sync: self.sync,
            drift_ms: self.drift_ms,
            now_playing,
            playing,
            error: self.error.clone(),
        }
    }

    fn publish(&self) {
        let snapshot = self.snapshot_value();
        if let Ok(mut guard) = self.snapshot.lock() {
            *guard = snapshot.clone();
        }
        let _ = self.app.emit("hush://session/state", snapshot);
    }
}

fn non_empty(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

#[derive(Deserialize)]
struct PositionPayload {
    position: f64,
    #[allow(dead_code)]
    duration: f64,
}

fn install_listeners(app: &AppHandle, local: Arc<Mutex<LocalPlayback>>, notify: Arc<Notify>) {
    let state_local = local.clone();
    let state_notify = notify;
    app.listen("player://state", move |event| {
        if let Ok(snapshot) = serde_json::from_str::<PlayerSnapshot>(event.payload()) {
            if let Ok(mut guard) = state_local.lock() {
                guard.track = snapshot.track.map(|track| SessionTrack {
                    id: track.id,
                    title: track.title,
                    artist: track.artist.unwrap_or_default(),
                    album: track.album.unwrap_or_default(),
                    cover_art: track.cover_art,
                    duration: track.duration.map(|duration| duration as f64).unwrap_or(0.0),
                });
                guard.position = snapshot.position;
                guard.playing = snapshot.status == PlaybackStatus::Playing;
                guard.updated_at = now_secs();
            }
            state_notify.notify_one();
        }
    });

    let position_local = local;
    app.listen("player://position", move |event| {
        if let Ok(payload) = serde_json::from_str::<PositionPayload>(event.payload()) {
            if let Ok(mut guard) = position_local.lock() {
                guard.position = payload.position;
                guard.updated_at = now_secs();
            }
        }
    });
}

async fn connection_task(
    url: String,
    initial: Vec<ClientMessage>,
    mut outbound: UnboundedReceiver<ClientMessage>,
    events: UnboundedSender<ConnectionEvent>,
    generation: u64,
) {
    let ws = match tokio_tungstenite::connect_async(&url).await {
        Ok((ws, _)) => ws,
        Err(err) => {
            let _ = events.send(ConnectionEvent::Closed(
                generation,
                format!("Could not reach the relay: {err}"),
            ));
            return;
        }
    };

    let (mut sink, mut stream) = ws.split();
    let _ = events.send(ConnectionEvent::Connected(generation));

    for message in initial {
        let text = match serde_json::to_string(&message) {
            Ok(text) => text,
            Err(_) => continue,
        };
        if sink.send(Message::Text(text.into())).await.is_err() {
            let _ = events.send(ConnectionEvent::Closed(
                generation,
                "Could not send to the relay.".to_string(),
            ));
            return;
        }
    }

    loop {
        tokio::select! {
            outgoing = outbound.recv() => {
                match outgoing {
                    Some(message) => {
                        let text = match serde_json::to_string(&message) {
                            Ok(text) => text,
                            Err(_) => continue,
                        };
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            let _ = events.send(ConnectionEvent::Closed(
                                generation,
                                "Connection to the relay was lost.".to_string(),
                            ));
                            return;
                        }
                    }
                    None => break,
                }
            }
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(message) = serde_json::from_str::<ServerMessage>(text.as_str()) {
                            let _ = events.send(ConnectionEvent::Message(generation, message));
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        let _ = events.send(ConnectionEvent::Closed(
                            generation,
                            "The relay closed the connection.".to_string(),
                        ));
                        return;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(err)) => {
                        let _ = events.send(ConnectionEvent::Closed(
                            generation,
                            format!("Connection error: {err}"),
                        ));
                        return;
                    }
                }
            }
        }
    }

    let _ = events.send(ConnectionEvent::Closed(
        generation,
        "Disconnected from the relay.".to_string(),
    ));
}