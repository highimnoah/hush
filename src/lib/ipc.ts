import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  AdvancedEvent,
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  ArtistImageCacheInfo,
  ArtistImageInfo,
  GainEvent,
  Genre,
  ImportedLyrics,
  LocalLyrics,
  LocalLyricsSummary,
  LrcLine,
  LrcMeta,
  Lyrics,
  PersistedPlayerState,
  PlaybackStatus,
  PlayerSnapshot,
  Playlist,
  PlaylistDetail,
  PositionEvent,
  RepeatMode,
  ReplayGainMode,
  SearchResults,
  ServerInfo,
  Settings,
  Song,
  StarKind,
  TrackInfo,
  TransitionMode,
  UiCommand,
  WaveformEvent,
  SessionSnapshot,
} from "./types";

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  updaterSupported: () => invoke<boolean>("updater_supported"),
  updateSettings: (settings: Settings) =>
    invoke<Settings>("update_settings", { settings }),
  testConnection: (settings: Settings) =>
    invoke<ServerInfo>("test_connection", { settings }),

  getArtists: () => invoke<Artist[]>("get_artists"),
  getAlbums: (sort = "newest", size = 100, offset = 0) =>
    invoke<Album[]>("get_albums", { sort, size, offset }),
  getAlbum: (id: string) => invoke<AlbumDetail>("get_album", { id }),
  getArtist: (id: string) => invoke<ArtistDetail>("get_artist", { id }),
  getSong: (id: string) => invoke<Song>("get_song", { id }),
  getPlaylists: () => invoke<Playlist[]>("get_playlists"),
  getPlaylist: (id: string) => invoke<PlaylistDetail>("get_playlist", { id }),
  search: (query: string) => invoke<SearchResults>("search", { query }),
  getSongsPage: (query = "", size = 200, offset = 0) =>
    invoke<Song[]>("get_songs", { query, size, offset }),
  searchAlbums: (query: string, size = 120, offset = 0) =>
    invoke<Album[]>("search_albums", { query, size, offset }),
  getStarred: () => invoke<SearchResults>("get_starred"),
  getRandomSongs: (size = 50) =>
    invoke<Song[]>("get_random_songs", { size }),
  artistImage: (name: string, serverUrl?: string | null) =>
    invoke<ArtistImageInfo | null>("artist_image", {
      name,
      serverUrl: serverUrl ?? null,
    }),
  artistImageCacheInfo: () =>
    invoke<ArtistImageCacheInfo>("artist_image_cache_info"),
  clearArtistImageCache: () =>
    invoke<ArtistImageCacheInfo>("clear_artist_image_cache"),
  getLyrics: (id: string) => invoke<Lyrics>("get_lyrics", { id }),
  getLocalLyrics: (trackId: string) =>
    invoke<LocalLyrics | null>("get_local_lyrics", { trackId }),
  listLocalLyrics: () =>
    invoke<LocalLyricsSummary[]>("list_local_lyrics"),
  saveLocalLyrics: (trackId: string, lines: LrcLine[], meta: LrcMeta) =>
    invoke<LocalLyrics>("save_local_lyrics", { trackId, lines, meta }),
  deleteLocalLyrics: (trackId: string) =>
    invoke<void>("delete_local_lyrics", { trackId }),
  exportLyricsFile: (trackId: string, path: string) =>
    invoke<void>("export_lyrics_file", { trackId, path }),
  importLyricsFile: (path: string) =>
    invoke<ImportedLyrics>("import_lyrics_file", { path }),
  playerPositionNow: () => invoke<number>("player_position_now"),
  getGenres: () => invoke<Genre[]>("get_genres"),
  getSongsByGenre: (genre: string, size = 200, offset = 0) =>
    invoke<Song[]>("get_songs_by_genre", { genre, size, offset }),
  getAlbumsByGenre: (genre: string, size = 50, offset = 0) =>
    invoke<Album[]>("get_albums_by_genre", { genre, size, offset }),
  createPlaylist: (name: string, songIds: string[] = []) =>
    invoke<PlaylistDetail>("create_playlist", { name, songIds }),
  replacePlaylist: (id: string, songIds: string[]) =>
    invoke<PlaylistDetail>("replace_playlist", { id, songIds }),
  updatePlaylist: (
    id: string,
    options: {
      name?: string | null;
      comment?: string | null;
      songIdsToAdd?: string[];
      songIndexesToRemove?: number[];
    } = {},
  ) =>
    invoke<void>("update_playlist", {
      id,
      name: options.name ?? null,
      comment: options.comment ?? null,
      songIdsToAdd: options.songIdsToAdd ?? [],
      songIndexesToRemove: options.songIndexesToRemove ?? [],
    }),
  deletePlaylist: (id: string) => invoke<void>("delete_playlist", { id }),
  getCoverArtUrl: (id: string, size = 600) =>
    invoke<string>("get_cover_art_url", { id, size }),
  getWaveform: (id: string) => invoke<number[] | null>("get_waveform", { id }),
  scrobble: (id: string, submission: boolean) =>
    invoke<void>("scrobble", { id, submission }),
  setStar: (kind: StarKind, id: string, starred: boolean) =>
    invoke<void>("set_star", { kind, id, starred }),

  playerLoad: (track: TrackInfo, startPosition = 0) =>
    invoke<void>("player_load", { track, startPosition }),
  playerPlay: () => invoke<void>("player_play"),
  playerPause: () => invoke<void>("player_pause"),
  playerStop: () => invoke<void>("player_stop"),
  playerSeek: (position: number) => invoke<void>("player_seek", { position }),
  playerSetVolume: (volume: number) =>
    invoke<void>("player_set_volume", { volume }),
  playerSetMute: (muted: boolean) => invoke<void>("player_set_mute", { muted }),
  playerPreload: (track: TrackInfo) =>
    invoke<void>("player_preload", { track }),
  playerClearPreload: () => invoke<void>("player_clear_preload"),
  playerSetTransition: (mode: TransitionMode, seconds: number) =>
    invoke<void>("player_set_transition", { mode, seconds }),
  playerFadeOut: (seconds: number, pauseAfter = true) =>
    invoke<void>("player_fade_out", { seconds, pauseAfter }),
  playerSleepAtEnd: (fadeSeconds: number) =>
    invoke<void>("player_sleep_at_end", { fadeSeconds }),
  playerCancelSleep: () => invoke<void>("player_cancel_sleep"),
  playerSetReplayGain: (mode: ReplayGainMode) =>
    invoke<void>("player_set_replaygain", { mode }),

  getPlayerState: () => invoke<PlayerSnapshot>("get_player_state"),
  getCurrentTrack: () => invoke<TrackInfo | null>("get_current_track"),
  getPlayerSession: () =>
    invoke<PersistedPlayerState | null>("get_player_session"),
  savePlayerSession: (session: PersistedPlayerState) =>
    invoke<void>("save_player_session", { session }),
  clearPlayerSession: () => invoke<void>("clear_player_session"),
  setPlaybackModes: (shuffle: boolean, repeat: RepeatMode) =>
    invoke<void>("set_playback_modes", { shuffle, repeat }),

  toggleMiniPlayer: (open: boolean) =>
    invoke<void>("toggle_mini_player", { open }),
  quitApp: () => invoke<void>("quit_app"),
  showMain: () => invoke<void>("show_main"),
  emitUiCommand: (action: string, value: string | null = null) =>
    invoke<void>("emit_ui_command", { action, value }),
  broadcastTrack: (track: TrackInfo | null) =>
    invoke<void>("broadcast_track", { track }),

  sessionCreate: () => invoke<void>("session_create"),
  sessionJoin: (code: string) => invoke<void>("session_join", { code }),
  sessionLeave: () => invoke<void>("session_leave"),
  getSessionState: () => invoke<SessionSnapshot>("session_get_state"),
};

export interface PlayerEventHandlers {
  state?: (snapshot: PlayerSnapshot) => void;
  position?: (event: PositionEvent) => void;
  ended?: () => void;
  error?: (message: string) => void;
  gain?: (event: GainEvent) => void;
  track?: (track: TrackInfo | null) => void;
  waveform?: (event: WaveformEvent) => void;
  session?: (snapshot: SessionSnapshot) => void;
  command?: (command: UiCommand) => void;
  advanced?: (event: AdvancedEvent) => void;
}

/**
 * Subscribe to all Rust-emitted player events. Returns a cleanup function.
 * Each subscription is guarded against the component unmounting before the
 * async `listen` promise resolves.
 */
export function subscribePlayerEvents(handlers: PlayerEventHandlers): () => void {
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];

  const track = (promise: Promise<UnlistenFn>) => {
    promise
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      })
      .catch(() => {
        /* event bus unavailable outside Tauri */
      });
  };

  if (handlers.state) {
    track(
      listen<PlayerSnapshot>("player://state", (event) =>
        handlers.state?.(event.payload),
      ),
    );
  }
  if (handlers.position) {
    track(
      listen<PositionEvent>("player://position", (event) =>
        handlers.position?.(event.payload),
      ),
    );
  }
  if (handlers.ended) {
    track(listen("player://ended", () => handlers.ended?.()));
  }
  if (handlers.error) {
    track(
      listen<{ message: string }>("player://error", (event) =>
        handlers.error?.(event.payload.message),
      ),
    );
  }
  if (handlers.gain) {
    track(
      listen<GainEvent>("player://gain", (event) => handlers.gain?.(event.payload)),
    );
  }
  if (handlers.track) {
    track(
      listen<TrackInfo | null>("hush://track", (event) =>
        handlers.track?.(event.payload),
      ),
    );
  }
  if (handlers.waveform) {
    track(
      listen<WaveformEvent>("hush://waveform", (event) =>
        handlers.waveform?.(event.payload),
      ),
    );
  }
  if (handlers.session) {
    track(
      listen<SessionSnapshot>("hush://session/state", (event) =>
        handlers.session?.(event.payload),
      ),
    );
  }
  if (handlers.command) {
    track(
      listen<UiCommand>("hush://command", (event) =>
        handlers.command?.(event.payload),
      ),
    );
  }
  if (handlers.advanced) {
    track(
      listen<AdvancedEvent>("player://advanced", (event) =>
        handlers.advanced?.(event.payload),
      ),
    );
  }
  return () => {
    disposed = true;
    for (const unlisten of unlisteners) unlisten();
    unlisteners.length = 0;
  };
}
