//! Windows media controls backed by System Media Transport Controls (SMTC).
//!
//! Uses `souvlaki` for the platform integration but keeps the same handle API
//! as the Linux MPRIS implementation so the player and commands stay agnostic.

use std::ffi::c_void;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::Duration;

use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use tauri::{AppHandle, Manager};

use crate::config::RepeatMode;
use crate::events;
use crate::player::{PlaybackStatus, TrackInfo};

enum SmtcCommand {
    Status(PlaybackStatus),
    Metadata(Box<TrackInfo>),
    ClearMetadata,
    Position(f64),
}

#[derive(Clone)]
pub struct MprisHandle {
    tx: Sender<SmtcCommand>,
}

impl MprisHandle {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();
        let _ = std::thread::Builder::new()
            .name("hush-smtc".to_string())
            .spawn(move || run(app, rx));
        Self { tx }
    }

    pub fn set_status(&self, status: PlaybackStatus) {
        let _ = self.tx.send(SmtcCommand::Status(status));
    }

    pub fn set_metadata(&self, track: &TrackInfo) {
        let _ = self.tx.send(SmtcCommand::Metadata(Box::new(track.clone())));
    }

    pub fn clear_metadata(&self) {
        let _ = self.tx.send(SmtcCommand::ClearMetadata);
    }

    pub fn set_position(&self, position: f64) {
        let _ = self.tx.send(SmtcCommand::Position(position));
    }

    /// SMTC has no volume surface; volume stays an in-app concern.
    pub fn set_volume(&self, _volume: f64) {}

    pub fn set_shuffle(&self, _shuffle: bool) {}

    pub fn set_repeat(&self, _repeat: RepeatMode) {}

    pub fn seeked(&self, position: f64) {
        let _ = self.tx.send(SmtcCommand::Position(position));
    }
}

fn run(app: AppHandle, rx: Receiver<SmtcCommand>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd.0 as *mut c_void,
        Err(err) => {
            eprintln!("[hush] could not resolve the window handle for SMTC: {err}");
            return;
        }
    };

    let config = PlatformConfig {
        dbus_name: "app.hush.desktop",
        display_name: "hush",
        hwnd: Some(hwnd),
    };

    let mut controls = match MediaControls::new(config) {
        Ok(controls) => controls,
        Err(err) => {
            eprintln!("[hush] Windows media controls unavailable: {err}");
            return;
        }
    };

    let handle = app.clone();
    if let Err(err) = controls.attach(move |event| handle_event(&handle, event)) {
        eprintln!("[hush] could not attach Windows media controls: {err}");
        return;
    }

    let mut status = PlaybackStatus::Stopped;
    let mut position = 0.0;

    while let Ok(command) = rx.recv() {
        match command {
            SmtcCommand::Status(next) => {
                status = next;
                let _ = apply_playback(&mut controls, status, position);
            }
            SmtcCommand::Metadata(track) => {
                let _ = controls.set_metadata(metadata_for(&track));
            }
            SmtcCommand::ClearMetadata => {
                let _ = controls.set_metadata(MediaMetadata::default());
            }
            SmtcCommand::Position(next) => {
                position = next.max(0.0);
                let _ = apply_playback(&mut controls, status, position);
            }
        }
    }
}

fn apply_playback(
    controls: &mut MediaControls,
    status: PlaybackStatus,
    position: f64,
) -> Result<(), souvlaki::Error> {
    let progress = Some(MediaPosition(Duration::from_secs_f64(position.max(0.0))));
    controls.set_playback(match status {
        PlaybackStatus::Playing => MediaPlayback::Playing { progress },
        PlaybackStatus::Paused => MediaPlayback::Paused { progress },
        PlaybackStatus::Stopped => MediaPlayback::Stopped,
    })
}

fn metadata_for(track: &TrackInfo) -> MediaMetadata<'_> {
    // SMTC fetches remote thumbnail URLs itself; only pass HTTPS covers so a
    // token-bearing query string is never sent over plain HTTP.
    let cover = track
        .cover_url
        .as_deref()
        .filter(|url| url.starts_with("https://"));

    MediaMetadata {
        title: Some(track.title.as_str()),
        album: track.album.as_deref(),
        artist: track.artist.as_deref(),
        cover_url: cover,
        duration: track.duration.map(|secs| Duration::from_secs(secs as u64)),
    }
}

fn handle_event(app: &AppHandle, event: MediaControlEvent) {
    match event {
        MediaControlEvent::Play => events::emit(app, "play", None),
        MediaControlEvent::Pause => events::emit(app, "pause", None),
        MediaControlEvent::Toggle => events::emit(app, "playPause", None),
        MediaControlEvent::Next => events::emit(app, "next", None),
        MediaControlEvent::Previous => events::emit(app, "previous", None),
        MediaControlEvent::Stop => events::emit(app, "stop", None),
        MediaControlEvent::Seek(direction) => {
            let delta = match direction {
                SeekDirection::Forward => 10.0,
                SeekDirection::Backward => -10.0,
            };
            events::emit(app, "seekBy", Some(delta.to_string()));
        }
        MediaControlEvent::SeekBy(direction, amount) => {
            let sign = match direction {
                SeekDirection::Forward => 1.0,
                SeekDirection::Backward => -1.0,
            };
            events::emit(
                app,
                "seekBy",
                Some((amount.as_secs_f64() * sign).to_string()),
            );
        }
        MediaControlEvent::SetPosition(MediaPosition(position)) => {
            events::emit(app, "seekTo", Some(position.as_secs_f64().to_string()));
        }
        MediaControlEvent::SetVolume(volume) => {
            events::emit(app, "setVolume", Some(volume.clamp(0.0, 1.0).to_string()));
        }
        MediaControlEvent::SetShuffle(shuffle) => {
            events::emit(app, "setShuffle", Some(shuffle.to_string()));
        }
        MediaControlEvent::Raise => crate::commands::show_main(app.clone()),
        MediaControlEvent::Quit => crate::commands::quit_app(app.clone()),
        _ => {}
    }
}
