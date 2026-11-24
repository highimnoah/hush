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
    let previous = state.config.get();
    let saved = state.config.set(settings)?;
    // A different server or user makes the saved queue meaningless.
    if previous.server_url != saved.server_url || previous.username != saved.username {
        let _ = state.session_store.clear();
    }
    state.player.send(Command::SetReplayGain(saved.replaygain));
    state.player.send(Command::SetPreamp(saved.replaygain_preamp));
    state.player.send(Command::SetTransition(
        saved.transition_mode,
        saved.fade_seconds as f64,
    ));
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
pub async fn get_songs(
    state: State<'_, AppState>,
    query: Option<String>,
    size: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<Song>> {
    build_server(&state)?
        .songs_page(
            &query.unwrap_or_default(),
            size.unwrap_or(200).clamp(1, 500),
            offset.unwrap_or(0),
        )
        .await
}

#[tauri::command]
pub async fn search_albums(
    state: State<'_, AppState>,
    query: String,
    size: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<Album>> {
    build_server(&state)?
        .albums_page(
            &query,
            size.unwrap_or(120).clamp(1, 500),
            offset.unwrap_or(0),
        )
        .await
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
pub async fn get_lyrics(
    state: State<'_, AppState>,
    id: String,
    meta: Option<crate::lrclib::LyricsMeta>,
) -> Result<Lyrics> {
    // hush's editable local layer always wins over provider lyrics.
    if let Some(local) = state.lyrics.get(&id) {
        let has_synced = local
            .synced
            .as_ref()
            .map(|lines| !lines.is_empty())
            .unwrap_or(false);
        let parsed = crate::lyrics::ParsedLrc {
            lines: local.lines,
            meta: local.meta,
            plain: local.plain,
            synced: local.synced,
            has_synced,
        };
        return Ok(crate::lyrics::to_lyrics(
            &parsed,
            crate::server::types::LyricsSource::Local,
        ));
    }

    // LRCLIB is the default provider; the music server is the fallback.
    if state.config.get().lrclib_lyrics {
        if let Some(meta) = meta.as_ref() {
            if let Some(lyrics) = state.lrclib.lyrics(&id, meta).await {
                return Ok(lyrics);
            }
        }
    }

    let mut lyrics = build_server(&state)?.lyrics(&id).await?;
    if lyrics.plain.is_none() && lyrics.synced.is_none() {
        lyrics.source = crate::server::types::LyricsSource::None;
    }
    Ok(lyrics)
}

#[tauri::command]
pub fn get_local_lyrics(
    state: State<'_, AppState>,
    track_id: String,
) -> Option<crate::lyrics::LocalLyrics> {
    state.lyrics.get(&track_id)
}

#[tauri::command]
pub fn list_local_lyrics(state: State<'_, AppState>) -> Vec<crate::lyrics::LocalLyricsSummary> {
    state.lyrics.list()
}

#[tauri::command]
pub fn save_local_lyrics(
    state: State<'_, AppState>,
    track_id: String,
    lines: Vec<crate::lyrics::LrcLine>,
    meta: crate::lyrics::LrcMeta,
) -> Result<crate::lyrics::LocalLyrics> {
    state.lyrics.save(&track_id, &lines, &meta)
}

#[tauri::command]
pub fn delete_local_lyrics(state: State<'_, AppState>, track_id: String) -> Result<()> {
    state.lyrics.delete(&track_id)
}

/// Write a local lyrics file to an arbitrary path (e.g. next to the audio file
/// on a mounted library so Navidrome picks it up on its next scan).
#[tauri::command]
pub fn export_lyrics_file(
    state: State<'_, AppState>,
    track_id: String,
    path: String,
) -> Result<()> {
    let local = state
        .lyrics
        .get(&track_id)
        .ok_or_else(|| HushError::Other("There are no saved lyrics for this track.".into()))?;
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::write(&path, local.text)?;
    Ok(())
}

/// Read an `.lrc`/`.txt` file from disk and parse it for the editor.
#[tauri::command]
pub fn import_lyrics_file(path: String) -> Result<crate::lyrics::ImportedLyrics> {
    let text = std::fs::read_to_string(&path)?;
    let parsed = crate::lyrics::parse(&text);
    Ok(crate::lyrics::ImportedLyrics {
        text,
        plain: parsed.plain,
        lines: parsed.lines,
        meta: parsed.meta,
    })
}

#[tauri::command]
pub fn player_position_now(state: State<'_, AppState>) -> f64 {
    state.player.position_now()
}

#[tauri::command]
pub async fn get_genres(state: State<'_, AppState>) -> Result<Vec<Genre>> {
    build_server(&state)?.genres().await
}

// ---------------------------------------------------------------------------
// Artist artwork
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn artist_image(
    state: State<'_, AppState>,
    name: String,
    server_url: Option<String>,
) -> Result<Option<crate::artist_images::ArtistImageInfo>> {
    let mode = state.config.get().artist_images;
    Ok(state.artist_images.resolve(&name, server_url, mode).await)
}

#[tauri::command]
pub fn artist_image_cache_info(state: State<'_, AppState>) -> crate::artist_images::CacheInfo {
    state.artist_images.info()
}

#[tauri::command]
pub fn clear_artist_image_cache(state: State<'_, AppState>) -> crate::artist_images::CacheInfo {
    state.artist_images.clear()
}

#[tauri::command]
pub async fn get_songs_by_genre(
    state: State<'_, AppState>,
    genre: String,
    size: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<Song>> {
    build_server(&state)?
        .songs_by_genre(&genre, size.unwrap_or(200), offset.unwrap_or(0))
        .await
}

#[tauri::command]
pub async fn get_albums_by_genre(
    state: State<'_, AppState>,
    genre: String,
    size: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<Album>> {
    build_server(&state)?
        .albums_by_genre(&genre, size.unwrap_or(50), offset.unwrap_or(0))
        .await
}

#[tauri::command]
pub async fn create_playlist(
    state: State<'_, AppState>,
    name: String,
    song_ids: Vec<String>,
) -> Result<PlaylistDetail> {
    build_server(&state)?
        .create_playlist(Some(&name), None, &song_ids)
        .await
}

#[tauri::command]
pub async fn replace_playlist(
    state: State<'_, AppState>,
    id: String,
    song_ids: Vec<String>,
) -> Result<PlaylistDetail> {
    build_server(&state)?
        .create_playlist(None, Some(&id), &song_ids)
        .await
}

#[tauri::command]
pub async fn update_playlist(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    comment: Option<String>,
    song_ids_to_add: Vec<String>,
    song_indexes_to_remove: Vec<u32>,
) -> Result<()> {
    build_server(&state)?
        .update_playlist(
            &id,
            name.as_deref(),
            comment.as_deref(),
            &song_ids_to_add,
            &song_indexes_to_remove,
        )
        .await
}

#[tauri::command]
pub async fn delete_playlist(state: State<'_, AppState>, id: String) -> Result<()> {
    build_server(&state)?.delete_playlist(&id).await
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
pub fn player_load(
    state: State<'_, AppState>,
    track: TrackInfo,
    start_position: Option<f64>,
) -> Result<()> {
    let settings = state.config.get();
    crate::playback::load_track(
        &state.player,
        &settings,
        &state.http,
        track,
        start_position.unwrap_or(0.0),
    )
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
pub fn player_preload(state: State<'_, AppState>, track: TrackInfo) -> Result<()> {
    let settings = state.config.get();
    crate::playback::preload_track(&state.player, &settings, &state.http, track)
}

#[tauri::command]
pub fn player_clear_preload(state: State<'_, AppState>) {
    state.player.send(Command::ClearPreload);
}

#[tauri::command]
pub fn player_set_levels_enabled(state: State<'_, AppState>, enabled: bool) {
    state.player.send(Command::SetLevelsEnabled(enabled));
}

#[tauri::command]
pub fn player_set_transition(
    state: State<'_, AppState>,
    mode: crate::config::TransitionMode,
    seconds: f64,
) {
    state.player.send(Command::SetTransition(mode, seconds));
}

#[tauri::command]
pub fn player_fade_out(state: State<'_, AppState>, seconds: f64, pause_after: bool) {
    state.player.send(Command::FadeOut {
        seconds,
        pause_after,
    });
}

#[tauri::command]
pub fn player_sleep_at_end(state: State<'_, AppState>, fade_seconds: f64) {
    state.player.send(Command::SleepAtTrackEnd { fade_seconds });
}

#[tauri::command]
pub fn player_cancel_sleep(state: State<'_, AppState>) {
    state.player.send(Command::CancelSleep);
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
pub fn get_waveform(
    state: State<'_, AppState>,
    id: String,
) -> Option<crate::player::waveform::WaveformData> {
    state.waveforms.get(&id)
}

/// Analyse a track on demand (used by views that are not playing it, such as
/// the lyrics editor). Progress and the final result arrive on `hush://waveform`.
#[tauri::command]
pub fn ensure_waveform(
    state: State<'_, AppState>,
    id: String,
    duration: f64,
) -> Option<crate::player::waveform::WaveformData> {
    if id.is_empty() {
        return None;
    }
    let url = build_server(&state).ok()?.stream_url(&id);
    if url.is_empty() {
        return None;
    }
    state.waveforms.ensure(id, url, duration.max(0.0))
}

// ---------------------------------------------------------------------------
// Resumable player session
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_player_session(
    state: State<'_, AppState>,
) -> Option<crate::session_state::PersistedPlayerState> {
    state.session_store.get()
}

#[tauri::command]
pub fn save_player_session(
    state: State<'_, AppState>,
    session: crate::session_state::PersistedPlayerState,
) -> Result<()> {
    state.session_store.set(session)
}

#[tauri::command]
pub fn clear_player_session(state: State<'_, AppState>) -> Result<()> {
    state.session_store.clear()
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

/// Tauri's updater can replace AppImages and Windows installers, but not
/// Debian/RPM packages. The AppImage runtime exports `APPIMAGE`; use it to
/// avoid offering a download that cannot be applied to a `.deb` install.
#[tauri::command]
pub fn updater_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_some()
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
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
