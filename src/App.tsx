import { AlertCircle, X } from "lucide-react";
import { useEffect } from "react";
import { HashRouter, Route, Routes, useLocation } from "react-router-dom";

import { NowPlaying } from "./components/NowPlaying";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { SongContextMenu } from "./components/ui/SongContextMenu";
import { ToastHost } from "./components/ui/ToastHost";
import { UpdateDialog } from "./components/ui/UpdateDialog";
import { WindowResizeHandles } from "./components/ui/WindowResizeHandles";
import { dataCache } from "./lib/cache";
import { api, subscribePlayerEvents } from "./lib/ipc";
import { setSpectrumBands } from "./lib/spectrum";
import type { RepeatMode } from "./lib/types";
import { usePlayer } from "./store/player";
import { useSession } from "./store/session";
import { isConfigured, useSettings } from "./store/settings";
import { useUpdater } from "./store/updater";
import styles from "./styles/layout.module.css";
import ui from "./styles/ui.module.css";
import { AlbumView } from "./views/AlbumView";
import { AlbumsView } from "./views/AlbumsView";
import { ArtistView } from "./views/ArtistView";
import { ArtistsView } from "./views/ArtistsView";
import { GenreView } from "./views/GenreView";
import { GenresView } from "./views/GenresView";
import { Home } from "./views/Home";
import { LikedView } from "./views/LikedView";
import { LyricsEditorView } from "./views/LyricsEditorView";
import { LyricsView } from "./views/LyricsView";
import { PlaylistView } from "./views/PlaylistView";
import { PlaylistsView } from "./views/PlaylistsView";
import { SettingsView } from "./views/SettingsView";
import { SongsView } from "./views/SongsView";
import { TogetherView } from "./views/TogetherView";

function parseNumber(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function handleUiCommand(action: string, value?: string) {
  const player = usePlayer.getState();
  switch (action) {
    case "playPause":
      player.toggle();
      break;
    case "play":
      player.play();
      break;
    case "pause":
      player.pause();
      break;
    case "stop":
      player.stop();
      break;
    case "next":
      player.next();
      break;
    case "previous":
      player.prev();
      break;
    case "seekBy":
      player.seekRelative(parseNumber(value));
      break;
    case "seekTo":
      player.seek(parseNumber(value));
      break;
    case "setVolume":
      player.setVolume(parseNumber(value));
      break;
    case "setShuffle":
      player.setShuffle(value === "true");
      break;
    case "setRepeat":
      if (value === "off" || value === "one" || value === "all") {
        player.setRepeat(value as RepeatMode);
      }
      break;
    default:
      break;
  }
}

function useAppBootstrap() {
  const loadSettings = useSettings((state) => state.load);
  const initPlayer = usePlayer((state) => state.init);
  const restoreSession = usePlayer((state) => state.restoreSession);
  const loadSession = useSession((state) => state.load);
  const loaded = useSettings((state) => state.loaded);
  const loadVersion = useUpdater((state) => state.loadVersion);

  useEffect(() => {
    async function boot() {
      await loadSettings();
      await initPlayer();
      await loadSession();
      if (isConfigured(useSettings.getState().settings)) {
        await restoreSession();
      }
    }
    void boot();
  }, [loadSettings, initPlayer, loadSession, restoreSession]);

  useEffect(() => {
    void loadVersion();
  }, [loadVersion]);

  // Once the app is loaded and configured, gently warm the caches for the
  // most common library views in the background. This keeps the first visit
  // to Albums/Artists/Songs snappy without blocking startup or playback.
  useEffect(() => {
    if (!loaded) return;
    if (!isConfigured(useSettings.getState().settings)) return;

    const prefetch = () => {
      if (!dataCache.has("artists:list")) {
        void api
          .getArtists()
          .then((data) => dataCache.set("artists:list", data))
          .catch(() => {});
      }
      if (!dataCache.has("albums:list:newest")) {
        void api
          .getAlbums("newest", 120)
          .then((data) => dataCache.set("albums:list:newest", data))
          .catch(() => {});
      }
      if (!dataCache.has("songs:page::0")) {
        void api
          .getSongsPage("", 200, 0)
          .then((data) => dataCache.set("songs:page::0", data))
          .catch(() => {});
      }
    };

    const handle = window.requestIdleCallback
      ? window.requestIdleCallback(prefetch, { timeout: 3000 })
      : window.setTimeout(prefetch, 800);

    return () => {
      if (window.cancelIdleCallback) {
        window.cancelIdleCallback(handle as number);
      } else {
        window.clearTimeout(handle as number);
      }
    };
  }, [loaded]);

  // Silent update check a few seconds after launch. Delayed so it never
  // competes with restoring the library/session at startup.
  useEffect(() => {
    if (!import.meta.env.PROD || !loaded) return;
    const timer = window.setTimeout(() => {
      const settings = useSettings.getState().settings;
      if (settings?.autoUpdate !== false) {
        void useUpdater.getState().check();
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [loaded]);

  useEffect(() => {
    const unsubscribe = subscribePlayerEvents({
      state: (snapshot) => usePlayer.getState().applySnapshot(snapshot),
      position: (event) =>
        usePlayer.getState().applyPosition(event.position, event.duration),
      ended: () => usePlayer.getState().onEnded(),
      error: (message) => usePlayer.getState().onError(message),
      gain: (event) => usePlayer.getState().setGain(event.applied),
      track: (track) => usePlayer.getState().onTrack(track),
      waveform: (event) =>
        usePlayer
          .getState()
          .setWaveform(event.trackId, event.peaks, event.complete),
      spectrum: (event) => setSpectrumBands(event.bands),
      session: (snapshot) => useSession.getState().setSnapshot(snapshot),
      command: (command) => handleUiCommand(command.action, command.value),
      advanced: (event) => usePlayer.getState().onAdvanced(event.trackId),
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    document.title = "hush";
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const editing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        Boolean(target?.isContentEditable);
      if (editing) return;

      const player = usePlayer.getState();

      if (
        event.code === "Space" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        if (tag === "BUTTON" || tag === "A") return;
        event.preventDefault();
        player.toggle();
        return;
      }

      if (event.ctrlKey && event.key === "ArrowRight") {
        event.preventDefault();
        player.next();
      } else if (event.ctrlKey && event.key === "ArrowLeft") {
        event.preventDefault();
        player.prev();
      } else if (event.ctrlKey && event.key === "ArrowUp") {
        event.preventDefault();
        player.setVolume(player.volume + 0.05);
      } else if (event.ctrlKey && event.key === "ArrowDown") {
        event.preventDefault();
        player.setVolume(player.volume - 0.05);
      } else if (event.ctrlKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        player.toggleMute();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

function Splash() {
  return (
    <div className={styles.splash} data-tauri-drag-region>
      <div className={styles.splashMark} aria-hidden="true" data-tauri-drag-region>
        <span />
        <span />
        <span />
      </div>
      <div className={styles.splashName}>hush</div>
      <div className={ui.spinner} />
    </div>
  );
}

export default function App() {
  useAppBootstrap();

  const loaded = useSettings((state) => state.loaded);

  if (!loaded) return <Splash />;

  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}

function AppShell() {
  const location = useLocation();
  const nowPlayingOpen = usePlayer((state) => state.nowPlayingOpen);
  const error = usePlayer((state) => state.error);
  const clearError = usePlayer((state) => state.clearError);

  useEffect(() => {
    const main = document.querySelector("[data-main]");
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  return (
    <>
      <div
        className={`${styles.app} ${nowPlayingOpen ? styles.appImmersive : ""}`}
      >
        <TitleBar />
        <Sidebar />
        <main className={styles.main} data-main>
          <div
            key={location.pathname}
            className={styles.viewTransition}
          >
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/songs" element={<SongsView />} />
              <Route path="/together" element={<TogetherView />} />
              <Route path="/artists" element={<ArtistsView />} />
              <Route path="/artists/:id" element={<ArtistView />} />
              <Route path="/albums" element={<AlbumsView />} />
              <Route path="/albums/:id" element={<AlbumView />} />
              <Route path="/genres" element={<GenresView />} />
              <Route path="/genres/:name" element={<GenreView />} />
              <Route path="/playlists" element={<PlaylistsView />} />
              <Route path="/playlists/:id" element={<PlaylistView />} />
              <Route path="/liked" element={<LikedView />} />
              <Route path="/lyrics" element={<LyricsView />} />
              <Route path="/lyrics/:trackId" element={<LyricsEditorView />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route path="*" element={<Home />} />
            </Routes>
          </div>
        </main>
        {nowPlayingOpen ? null : (
          <div className={styles.playerSlot}>
            <PlayerBar />
          </div>
        )}
      </div>

      <NowPlaying />
      <QueuePanel />
      <SongContextMenu />
      <ToastHost />
      <UpdateDialog />
      <WindowResizeHandles />

      {error ? (
        <div className={styles.errorToast} role="alert">
          <AlertCircle size={16} className={styles.toastIcon} />
          <span>{error}</span>
          <button
            type="button"
            className={styles.toastClose}
            onClick={clearError}
            aria-label="Dismiss error"
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
    </>
  );
}
