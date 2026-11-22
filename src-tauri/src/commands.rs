use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::config::{RepeatMode, Settings};
use crate::discord::DiscordConfig;
use crate::error::{HushError, Result};
use crate::player::{Command, PlayerSnapshot, TrackInfo};
use crate::server::types::*;
use crate::server::{self, AlbumSort, MusicServer};
use crate::AppState;

fn build_server(state: &AppState) -> Result<std::sync::Arc<dyn MusicServer>> {
    server::build(&state.config.get(), state.http.clone())
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.config.get()
}

#[tauri::command]
pub fn update_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings> {
    let saved = state.config.set(settings)?;
    state.player.send(Command::SetReplayGain(saved.replaygain));
    state.player.send(Command::SetPreamp(saved.replaygain_preamp));
    state.discord.configure(DiscordConfig::from(&saved));
    Ok(saved)
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<ServerInfo> {
    let http = state.http.clone();
    let client = server::build(&settings, http)?;
    let mut info = client.ping().await?;
    info.name = Some(settings.display_server_name());
    Ok(info)
}

// ---------------------------------------------------------------------------
// Library browsing
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_artists(state: State<'_, AppState>) -> Result<Vec<Artist>> {
    build_server(&state)?.artists().await
}

#[tauri::command]
pub async fn get_albums(
    state: State<'_, AppState>,
    sort: Option<String>,
    size: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<Album>> {
    let sort = AlbumSort::parse(sort.as_deref().unwrap_or("newest"));
    build_server(&state)?
        .album_list(sort, size.unwrap_or(100), offset.unwrap_or(0))
        .await
}

#[tauri::command]
pub async fn get_album(state: State<'_, AppState>, id: String) -> Result<AlbumDetail> {
    build_server(&state)?.album(&id).await
}

#[tauri::command]
pub async fn get_artist(state: State<'_, AppState>, id: String) -> Result<ArtistDetail> {
    build_server(&state)?.artist(&id).await
}

#[tauri::command]
pub async fn get_song(state: State<'_, AppState>, id: String) -> Result<Song> {
    build_server(&state)?.song(&id).await
}

#[tauri::command]
pub async fn get_playlists(state: State<'_, AppState>) -> Result<Vec<Playlist>> {
    build_server(&state)?.playlists().await
}

#[tauri::command]
pub async fn get_playlist(state: State<'_, AppState>, id: String) -> Result<PlaylistDetail> {
    build_server(&state)?.playlist(&id).await
}

#[tauri::command]
pub async fn search(state: State<'_, AppState>, query: String) -> Result<SearchResults> {
    if query.trim().is_empty() {
        return Ok(SearchResults::default());
    }
    build_server(&state)?.search(query.trim()).await
}

#[tauri::command]
pub async fn get_starred(state: State<'_, AppState>) -> Result<SearchResults> {
    build_server(&state)?.starred().await
}

#[tauri::command]
pub async fn get_random_songs(
    state: State<'_, AppState>,
    size: Option<u32>,
) -> Result<Vec<Song>> {
    build_server(&state)?.random_songs(size.unwrap_or(50)).await
}

#[tauri::command]
pub fn get_cover_art_url(
    state: State<'_, AppState>,
    id: String,
    size: Option<u32>,
) -> Result<String> {
    Ok(build_server(&state)?.cover_url(&id, size.unwrap_or(600)))
}

#[tauri::command]
pub async fn scrobble(
    state: State<'_, AppState>,
    id: String,
    submission: bool,
) -> Result<()> {
    build_server(&state)?.scrobble(&id, submission).await
}

#[tauri::command]
pub async fn set_star(
    state: State<'_, AppState>,
    kind: crate::server::StarKind,
    id: String,
    starred: bool,
) -> Result<()> {
    build_server(&state)?.set_star(kind, &id, starred).await
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn player_load(state: State<'_, AppState>, track: TrackInfo) -> Result<()> {
    let settings = state.config.get();
    crate::playback::load_track(&state.player, &settings, &state.http, track)
}

#[tauri::command]
pub fn player_play(state: State<'_, AppState>) {
    state.player.send(Command::Play);
}

#[tauri::command]
pub fn player_pause(state: State<'_, AppState>) {
    state.player.send(Command::Pause);
}

#[tauri::command]
pub fn player_stop(state: State<'_, AppState>) {
    state.player.send(Command::Stop);
}

#[tauri::command]
pub fn player_seek(state: State<'_, AppState>, position: f64) {
    state.player.send(Command::Seek(position));
}

#[tauri::command]
pub fn player_set_volume(state: State<'_, AppState>, volume: f64) {
    state.player.send(Command::SetVolume(volume));
}

#[tauri::command]
pub fn player_set_mute(state: State<'_, AppState>, muted: bool) {
    state.player.send(Command::SetMute(muted));
}

#[tauri::command]
pub fn player_set_replaygain(state: State<'_, AppState>, mode: crate::config::ReplayGainMode) {
    let mut settings = state.config.get();
    settings.replaygain = mode;
    let _ = state.config.set(settings);
    state.player.send(Command::SetReplayGain(mode));
}

#[tauri::command]
pub fn get_player_state(state: State<'_, AppState>) -> PlayerSnapshot {
    state.player.snapshot()
}

#[tauri::command]
pub fn get_current_track(state: State<'_, AppState>) -> Option<TrackInfo> {
    state.player.snapshot().track
}

#[tauri::command]
pub fn get_waveform(state: State<'_, AppState>, id: String) -> Option<Vec<f32>> {
    state.waveforms.get(&id)
}

// ---------------------------------------------------------------------------
// Listen together
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn session_create(state: State<'_, AppState>) {
    state.session.create();
}

#[tauri::command]
pub fn session_join(state: State<'_, AppState>, code: String) {
    state.session.join(code);
}

#[tauri::command]
pub fn session_leave(state: State<'_, AppState>) {
    state.session.leave();
}

#[tauri::command]
pub fn session_get_state(state: State<'_, AppState>) -> crate::session::SessionSnapshot {
    state.session.snapshot()
}

#[tauri::command]
pub fn set_playback_modes(state: State<'_, AppState>, shuffle: bool, repeat: RepeatMode) {
    state.mpris.set_shuffle(shuffle);
    state.mpris.set_repeat(repeat);
}

// ---------------------------------------------------------------------------
// Window / app control
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn toggle_mini_player(app: AppHandle, open: bool) -> Result<()> {
    if open {
        if let Some(window) = app.get_webview_window("mini") {
            let _ = window.show();
            let _ = window.set_focus();
            return Ok(());
        }

        let window = WebviewWindowBuilder::new(
            &app,
            "mini",
            WebviewUrl::App("index.html".into()),
        )
        .title("hush")
        .inner_size(380.0, 140.0)
        .min_inner_size(340.0, 124.0)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .initialization_script("window.__HUSH_MINI__ = true;")
        .build()
        .map_err(|err| HushError::Other(format!("Could not open mini player: {err}")))?;

        let _ = window.set_focus();
    } else if let Some(window) = app.get_webview_window("mini") {
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn show_main(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn emit_ui_command(app: AppHandle, action: String, value: Option<String>) {
    crate::events::emit(&app, &action, value);
}

/// Broadcast helper so the main window can mirror the current track to the
/// mini player (which fetches initial state but also listens for updates).
#[tauri::command]
pub fn broadcast_track(app: AppHandle, track: Option<TrackInfo>) {
    let _ = app.emit("hush://track", track);
}
