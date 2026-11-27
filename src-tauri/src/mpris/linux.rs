use mpris_server::{LoopStatus, Metadata, PlaybackStatus as MprisStatus, Player, Time, TrackId};
use tauri::AppHandle;

use crate::config::RepeatMode;
use crate::events;
use crate::player::{PlaybackStatus, TrackInfo};

pub enum MprisCommand {
    Status(PlaybackStatus),
    Metadata(Box<TrackInfo>),
    ClearMetadata,
    Position(f64),
    Volume(f64),
    Shuffle(bool),
    Repeat(RepeatMode),
    Seeked(f64),
}

#[derive(Clone)]
pub struct MprisHandle {
    tx: tokio::sync::mpsc::UnboundedSender<MprisCommand>,
}

impl MprisHandle {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let _ = std::thread::Builder::new()
            .name("hush-mpris".to_string())
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(err) => {
                        eprintln!("[hush] could not start MPRIS runtime: {err}");
                        return;
                    }
                };
                let local = tokio::task::LocalSet::new();
                local.block_on(&runtime, run(app, rx));
            });
        Self { tx }
    }

    pub fn set_status(&self, status: PlaybackStatus) {
        let _ = self.tx.send(MprisCommand::Status(status));
    }

    pub fn set_metadata(&self, track: &TrackInfo) {
        let _ = self
            .tx
            .send(MprisCommand::Metadata(Box::new(track.clone())));
    }

    pub fn clear_metadata(&self) {
        let _ = self.tx.send(MprisCommand::ClearMetadata);
    }

    pub fn set_position(&self, position: f64) {
        let _ = self.tx.send(MprisCommand::Position(position));
    }

    pub fn set_volume(&self, volume: f64) {
        let _ = self.tx.send(MprisCommand::Volume(volume));
    }

    pub fn set_shuffle(&self, shuffle: bool) {
        let _ = self.tx.send(MprisCommand::Shuffle(shuffle));
    }

    pub fn set_repeat(&self, repeat: RepeatMode) {
        let _ = self.tx.send(MprisCommand::Repeat(repeat));
    }

    pub fn seeked(&self, position: f64) {
        let _ = self.tx.send(MprisCommand::Seeked(position));
    }
}

async fn run(app: AppHandle, mut rx: tokio::sync::mpsc::UnboundedReceiver<MprisCommand>) {
    let player = match Player::builder("hush")
        .identity("hush")
        .can_play(true)
        .can_pause(true)
        .can_go_next(true)
        .can_go_previous(true)
        .can_seek(true)
        .can_control(true)
        .build()
        .await
    {
        Ok(player) => player,
        Err(err) => {
            eprintln!("[hush] MPRIS media controls unavailable: {err}");
            return;
        }
    };

    connect_events(&player, &app);

    // Must be spawned on the same local runtime as the player.
    tokio::task::spawn_local(player.run());

    while let Some(command) = rx.recv().await {
        match command {
            MprisCommand::Status(status) => {
                let _ = player.set_playback_status(map_status(status)).await;
            }
            MprisCommand::Metadata(track) => {
                let _ = player.set_metadata(build_metadata(&track)).await;
            }
            MprisCommand::ClearMetadata => {
                let _ = player.set_metadata(Metadata::new()).await;
            }
            MprisCommand::Position(position) => {
                player.set_position(time_from(position));
            }
            MprisCommand::Volume(volume) => {
                let _ = player.set_volume(volume.clamp(0.0, 1.0)).await;
            }
            MprisCommand::Shuffle(shuffle) => {
                let _ = player.set_shuffle(shuffle).await;
            }
            MprisCommand::Repeat(repeat) => {
                let _ = player.set_loop_status(map_repeat(repeat)).await;
            }
            MprisCommand::Seeked(position) => {
                let _ = player.seeked(time_from(position)).await;
            }
        }
    }
}

fn connect_events(player: &Player, app: &AppHandle) {
    let handle = app.clone();
    player.connect_play_pause(move |_| events::emit(&handle, "playPause", None));

    let handle = app.clone();
    player.connect_play(move |_| events::emit(&handle, "play", None));

    let handle = app.clone();
    player.connect_pause(move |_| events::emit(&handle, "pause", None));

    let handle = app.clone();
    player.connect_stop(move |_| events::emit(&handle, "stop", None));

    let handle = app.clone();
    player.connect_next(move |_| events::emit(&handle, "next", None));

    let handle = app.clone();
    player.connect_previous(move |_| events::emit(&handle, "previous", None));

    let handle = app.clone();
    player.connect_seek(move |_player, offset| {
        let seconds = offset.as_micros() as f64 / 1_000_000.0;
        events::emit(&handle, "seekBy", Some(seconds.to_string()));
    });

    let handle = app.clone();
    player.connect_set_position(move |_player, _track, position| {
        let seconds = position.as_micros() as f64 / 1_000_000.0;
        events::emit(&handle, "seekTo", Some(seconds.to_string()));
    });

    let handle = app.clone();
    player.connect_set_volume(move |_player, volume| {
        events::emit(&handle, "setVolume", Some(volume.to_string()));
    });

    let handle = app.clone();
    player.connect_set_shuffle(move |_player, shuffle| {
        events::emit(&handle, "setShuffle", Some(shuffle.to_string()));
    });

    let handle = app.clone();
    player.connect_set_loop_status(move |_player, status| {
        let value = match status {
            LoopStatus::None => "off",
            LoopStatus::Track => "one",
            LoopStatus::Playlist => "all",
        };
        events::emit(&handle, "setRepeat", Some(value.to_string()));
    });
}

fn build_metadata(track: &TrackInfo) -> Metadata {
    let mut builder = Metadata::builder()
        .title(track.title.clone())
        .length(time_from(track.duration.unwrap_or(0) as f64));

    if let Some(artist) = &track.artist {
        if !artist.is_empty() {
            builder = builder.artist([artist.clone()]);
        }
    }
    if let Some(album) = &track.album {
        if !album.is_empty() {
            builder = builder.album(album.clone());
        }
    }
    if let Some(album_artist) = &track.album_artist {
        if !album_artist.is_empty() {
            builder = builder.album_artist([album_artist.clone()]);
        }
    }
    if let Some(cover) = &track.cover_url {
        if !cover.is_empty() {
            builder = builder.art_url(cover.clone());
        }
    }
    if let Ok(track_id) = TrackId::try_from(format!("/hush/track/{}", sanitize(&track.id))) {
        builder = builder.trackid(track_id);
    }

    builder.build()
}

fn sanitize(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    if cleaned.is_empty() {
        "unknown".to_string()
    } else {
        cleaned
    }
}

fn map_status(status: PlaybackStatus) -> MprisStatus {
    match status {
        PlaybackStatus::Playing => MprisStatus::Playing,
        PlaybackStatus::Paused => MprisStatus::Paused,
        PlaybackStatus::Stopped => MprisStatus::Stopped,
    }
}

fn map_repeat(repeat: RepeatMode) -> LoopStatus {
    match repeat {
        RepeatMode::Off => LoopStatus::None,
        RepeatMode::One => LoopStatus::Track,
        RepeatMode::All => LoopStatus::Playlist,
    }
}

fn time_from(seconds: f64) -> Time {
    let micros = if seconds.is_finite() {
        (seconds.max(0.0) * 1_000_000.0) as i64
    } else {
        0
    };
    Time::from_micros(micros)
}
