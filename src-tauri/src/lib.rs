pub mod commands;
pub mod config;
pub mod discord;
pub mod error;
pub mod events;
pub mod mpris;
pub mod playback;
pub mod player;
pub mod server;
pub mod session;
pub mod session_state;
mod tray;

use std::sync::Arc;

use tauri::Manager;

use config::ConfigStore;
use discord::DiscordHandle;
use mpris::MprisHandle;
use player::waveform::WaveformHandle;
use player::PlayerHandle;
use session::SessionHandle;
use session_state::SessionStore;

/// Shared application state managed by Tauri.
pub struct AppState {
    pub config: Arc<ConfigStore>,
    pub player: PlayerHandle,
    pub discord: DiscordHandle,
    pub mpris: MprisHandle,
    pub waveforms: WaveformHandle,
    pub session: SessionHandle,
    pub session_store: Arc<SessionStore>,
    pub http: reqwest::Client,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_bundled_gstreamer();
    enable_software_rendering_if_requested();

    let app = tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();

            let http = reqwest::Client::builder()
                .user_agent("hush/0.1.0")
                .timeout(std::time::Duration::from_secs(20))
                .build()?;

            let config_dir = app.path().app_config_dir()?;
            config::ensure_config_dir(&config_dir)?;
            let session_store = Arc::new(SessionStore::load(config_dir.clone()));
            let config = Arc::new(ConfigStore::load(config_dir));
            let settings = config.get();

            restore_window_state(app.handle(), &settings);

            let discord = DiscordHandle::spawn();
            discord.configure(discord::DiscordConfig::from(&settings));

            let mpris = MprisHandle::spawn(handle.clone());
            let waveforms = WaveformHandle::new();

            let player = PlayerHandle::spawn(
                handle.clone(),
                discord.clone(),
                mpris.clone(),
                waveforms.clone(),
                settings.volume,
                settings.muted,
                settings.replaygain,
                settings.replaygain_preamp,
                settings.transition_mode,
                settings.fade_seconds as f64,
            );

            let session = SessionHandle::spawn(
                handle.clone(),
                player.clone(),
                config.clone(),
                http.clone(),
            );

            if let Err(err) = tray::create(app.handle()) {
                eprintln!("[hush] could not create system tray: {err}");
            }

            app.manage(AppState {
                config,
                player,
                discord,
                mpris,
                waveforms,
                session,
                session_store,
                http,
            });

            // Persist volume + window size when the main window is closed, even
            // if another window (the mini player) is still open.
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        persist_state(&handle);
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::test_connection,
            commands::get_artists,
            commands::get_albums,
            commands::get_album,
            commands::get_artist,
            commands::get_song,
            commands::get_playlists,
            commands::get_playlist,
            commands::search,
            commands::get_starred,
            commands::get_random_songs,
            commands::get_lyrics,
            commands::get_genres,
            commands::get_songs_by_genre,
            commands::get_albums_by_genre,
            commands::create_playlist,
            commands::replace_playlist,
            commands::update_playlist,
            commands::delete_playlist,
            commands::get_cover_art_url,
            commands::get_waveform,
            commands::scrobble,
            commands::set_star,
            commands::player_load,
            commands::player_play,
            commands::player_pause,
            commands::player_stop,
            commands::player_seek,
            commands::player_set_volume,
            commands::player_set_mute,
            commands::player_preload,
            commands::player_clear_preload,
            commands::player_set_levels_enabled,
            commands::player_set_transition,
            commands::player_fade_out,
            commands::player_sleep_at_end,
            commands::player_cancel_sleep,
            commands::player_set_replaygain,
            commands::get_player_state,
            commands::get_current_track,
            commands::set_playback_modes,
            commands::toggle_mini_player,
            commands::quit_app,
            commands::show_main,
            commands::emit_ui_command,
            commands::broadcast_track,
            commands::session_create,
            commands::session_join,
            commands::session_leave,
            commands::session_get_state,
            commands::get_player_session,
            commands::save_player_session,
            commands::clear_player_session,
        ])
        .build(tauri::generate_context!())
        .expect("error while building hush");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            persist_state(app_handle);
        }
    });
}

fn restore_window_state(app: &tauri::AppHandle, settings: &config::Settings) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    // Wayland compositors derive the title-bar icon from the app id/desktop
    // file; set it explicitly so the bundled hush icon is always used.
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png")) {
        let _ = window.set_icon(icon);
    }

    if let (Some(width), Some(height)) = (settings.window_width, settings.window_height) {
        let width = width.max(1020) as f64;
        let height = height.max(640) as f64;
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
    }

    if settings.window_maximized {
        let _ = window.maximize();
    }
}

fn persist_state(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let snapshot = state.player.snapshot();
    let mut settings = state.config.get();
    settings.volume = snapshot.volume.clamp(0.0, 1.0);
    settings.muted = snapshot.muted;

    if let Some(window) = app.get_webview_window("main") {
        let maximized = window.is_maximized().unwrap_or(false);
        settings.window_maximized = maximized;

        if !maximized {
            if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
                let logical = size.to_logical::<f64>(scale);
                if logical.width >= 400.0 && logical.height >= 300.0 {
                    settings.window_width = Some(logical.width.round() as u32);
                    settings.window_height = Some(logical.height.round() as u32);
                }
            }
        }
    }

    let _ = state.config.set(settings);
}

/// Configure the GStreamer runtime that ships with a bundled build.
///
/// On Windows this points GStreamer at the DLLs, plugins, scanner and CA
/// bundle next to `hush.exe`. On Linux it only isolates the AppImage's plugin
/// registry; `.deb`/source builds keep using the system GStreamer.
fn configure_bundled_gstreamer() {
    #[cfg(target_os = "windows")]
    windows_gstreamer::configure();

    // The AppImage carries its own GStreamer runtime and plugins. Point at the
    // bundled plugin/scanner paths explicitly and give it a private registry
    // cache so it never reads a cache written by the host's (possibly newer)
    // GStreamer installation.
    #[cfg(target_os = "linux")]
    if let Some(appdir) = std::env::var_os("APPDIR").map(std::path::PathBuf::from) {
        let plugins = appdir.join("usr/lib/gstreamer-1.0");
        if plugins.is_dir() {
            std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", &plugins);
            std::env::set_var("GST_PLUGIN_PATH_1_0", &plugins);
        }

        // Different distros put the scanner either next to the plugins or in
        // the multiarch helper directory.
        let scanner = [
            plugins.join("gst-plugin-scanner"),
            appdir.join("usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"),
        ]
        .into_iter()
        .find(|path| path.is_file());
        if let Some(scanner) = scanner {
            std::env::set_var("GST_PLUGIN_SCANNER_1_0", &scanner);
        }

        let ptp = [
            plugins.join("gst-ptp-helper"),
            appdir.join("usr/lib/gstreamer1.0/gstreamer-1.0/gst-ptp-helper"),
        ]
        .into_iter()
        .find(|path| path.is_file());
        if let Some(ptp) = ptp {
            std::env::set_var("GST_PTP_HELPER_1_0", &ptp);
        }

        let cache = std::env::var_os("XDG_CACHE_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|home| std::path::PathBuf::from(home).join(".cache"))
            })
            .unwrap_or_else(std::env::temp_dir)
            .join("hush");
        if std::fs::create_dir_all(&cache).is_ok() {
            std::env::set_var("GST_REGISTRY", cache.join("gstreamer-registry.bin"));
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_gstreamer {
    use std::path::{Path, PathBuf};

    pub fn configure() {
        let Some(root) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
        else {
            return;
        };

        // Only take over when the runtime DLLs are actually bundled next to the
        // executable. Development builds use the system GStreamer install.
        let has_runtime = root.join("gstreamer-1.0-0.dll").is_file()
            || root.join("libgstreamer-1.0-0.dll").is_file();
        let plugins = root.join("lib").join("gstreamer-1.0");
        if !has_runtime || !plugins.is_dir() {
            return;
        }

        // The bundled runtime must be self-contained. Replace any system
        // GStreamer paths instead of appending them: mixing a system install
        // with the MSVC bundle is a common source of silent plugin failures.
        // GStreamer gives the `_1_0` variants precedence over the generic
        // names, so set both.
        std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", &plugins);
        std::env::set_var("GST_PLUGIN_SYSTEM_PATH", &plugins);
        std::env::set_var("GST_PLUGIN_PATH_1_0", &plugins);
        std::env::set_var("GST_PLUGIN_PATH", &plugins);

        let gio_modules = root.join("lib").join("gio").join("modules");
        if gio_modules.is_dir() {
            std::env::set_var("GIO_EXTRA_MODULES", &gio_modules);
        }

        let schemas = root
            .join("share")
            .join("glib-2.0")
            .join("schemas");
        if schemas.is_dir() {
            std::env::set_var("GSETTINGS_SCHEMA_DIR", &schemas);
        }

        // Use an app-private plugin registry cache. The default Windows cache
        // is shared with every other GStreamer application and can contain
        // plugin paths from a different (or older) installation.
        let cache_dir = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("app.hush.desktop");
        let _ = std::fs::create_dir_all(&cache_dir);
        let registry = cache_dir.join("gstreamer-registry.bin");
        std::env::set_var("GST_REGISTRY", &registry);

        if std::env::var_os("HUSH_GST_DEBUG").is_some() {
            std::env::set_var("GST_DEBUG", "4");
            std::env::set_var("GST_DEBUG_FILE", cache_dir.join("gstreamer.log"));
        }

        // Prefer a scanner next to the runtime DLLs. Windows resolves the
        // scanner's own DLL imports (gstreamer, glib, VCRUNTIME140) from its
        // directory, which avoids relying on PATH inheritance.
        let scanner = [
            root.join("gst-plugin-scanner.exe"),
            root.join("libexec")
                .join("gstreamer-1.0")
                .join("gst-plugin-scanner.exe"),
        ]
        .into_iter()
        .find(|path| path.is_file());
        if let Some(scanner) = scanner {
            std::env::set_var("GST_PLUGIN_SCANNER_1_0", &scanner);
            std::env::set_var("GST_PLUGIN_SCANNER", &scanner);
        }

        // glib-networking's TLS backends (OpenSSL/GnuTLS) need a CA bundle.
        // The GStreamer runtime ships one under etc/ssl/certs.
        let ca = root
            .join("etc")
            .join("ssl")
            .join("certs")
            .join("ca-certificates.crt");
        if ca.is_file() {
            std::env::set_var("SSL_CERT_FILE", &ca);
        }

        // Make the runtime's directory an explicit DLL search directory too,
        // so plugin DLLs and the scanner find their dependencies even when
        // PATH is unusual.
        set_dll_directory(&root);
        prepend_path("PATH", &root);
    }

    fn set_dll_directory(path: &Path) {
        use std::os::windows::ffi::OsStrExt;

        #[link(name = "kernel32")]
        extern "system" {
            fn SetDllDirectoryW(path: *const u16) -> i32;
        }

        let wide: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            SetDllDirectoryW(wide.as_ptr());
        }
    }

    fn prepend_path(key: &str, value: &Path) {
        let mut paths: Vec<PathBuf> = vec![value.to_path_buf()];
        if let Some(existing) = std::env::var_os(key) {
            paths.extend(std::env::split_paths(&existing));
        }
        if let Ok(joined) = std::env::join_paths(paths) {
            std::env::set_var(key, joined);
        }
    }
}

/// Set `HUSH_SOFTWARE_RENDERING=1` to force WebKitGTK into a software-rendered
/// path. Useful on some NVIDIA + Wayland combinations.
fn enable_software_rendering_if_requested() {
    if std::env::var_os("HUSH_SOFTWARE_RENDERING").is_none() {
        return;
    }
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}
