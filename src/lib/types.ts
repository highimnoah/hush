// Shared types mirroring the Rust DTOs (serde camelCase).

export type ReplayGainMode = "off" | "track" | "album";
export type RepeatMode = "off" | "one" | "all";
export type PlaybackStatus = "stopped" | "playing" | "paused";
export type StarKind = "song" | "album";
export type TransitionMode = "gapless" | "fade";
export type SleepMode = "minutes" | "endOfTrack" | "endOfQueue";
export type FullscreenPanel = "queue" | "lyrics" | "info";
export type ArtistImageMode = "off" | "server" | "auto";

export interface ArtistImageInfo {
  source: string;
  url: string;
}

export interface ArtistImageCacheInfo {
  bytes: number;
  count: number;
}

export interface Song {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  albumId?: string;
  artistId?: string;
  coverArt?: string;
  duration?: number;
  track?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  suffix?: string;
  contentType?: string;
  bitRate?: number;
  bitDepth?: number;
  samplingRate?: number;
  channelCount?: number;
  size?: number;
  starred?: string;
  playCount?: number;
  /** OpenSubsonic/Navidrome explicit content status: "explicit" | "clean" | "". */
  explicitStatus?: string;
}

export interface Album {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  year?: number;
  genre?: string;
  created?: string;
  starred?: string;
  explicitStatus?: string;
}

export interface Genre {
  value: string;
  songCount?: number;
  albumCount?: number;
}

export interface Artist {
  id: string;
  name: string;
  albumCount?: number;
  coverArt?: string;
  artistImageUrl?: string;
  starred?: string;
}

export interface AlbumDetail {
  album: Album;
  songs: Song[];
}

export interface ArtistDetail {
  artist: Artist;
  albums: Album[];
}

export interface Playlist {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  songCount?: number;
  duration?: number;
  coverArt?: string;
  created?: string;
  changed?: string;
}

export interface PlaylistDetail {
  playlist: Playlist;
  songs: Song[];
}

export interface SearchResults {
  artists: Artist[];
  albums: Album[];
  songs: Song[];
}

export interface LyricLine {
  startMs: number;
  text: string;
}

export type LyricsSource = "none" | "local" | "lrclib" | "server";

export interface LyricsMeta {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration?: number | null;
}

export interface Lyrics {
  plain: string | null;
  synced: LyricLine[] | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  source: LyricsSource;
}

export interface LrcLine {
  startMs: number | null;
  text: string;
}

export interface LrcMeta {
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
}

export interface LocalLyrics {
  trackId: string;
  text: string;
  plain: string | null;
  synced: LyricLine[] | null;
  lines: LrcLine[];
  meta: LrcMeta;
  updatedMs: number | null;
}

export interface LocalLyricsSummary {
  trackId: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  updatedMs: number | null;
  synced: boolean;
  lineCount: number;
}

export interface ImportedLyrics {
  text: string;
  plain: string | null;
  lines: LrcLine[];
  meta: LrcMeta;
}

export interface ServerInfo {
  version: string;
  kind?: string;
  name?: string;
}

export interface Settings {
  serverUrl: string;
  username: string;
  password: string;
  token: string;
  salt: string;
  serverName: string;
  replaygain: ReplayGainMode;
  replaygainPreamp: number;
  volume: number;
  muted: boolean;
  resumePlayback: boolean;
  lrclibLyrics: boolean;
  transitionMode: TransitionMode;
  fadeSeconds: number;
  discordEnabled: boolean;
  discordClientId: string;
  discordDetails: string;
  discordState: string;
  discordLargeImage: string;
  discordTimestamps: boolean;
  discordUseCover: boolean;
  fullscreenSidebarOpen: boolean;
  fullscreenSidebarPanel: FullscreenPanel;
  artistImages: ArtistImageMode;
  autoUpdate: boolean;
  sessionName: string;
  sessionRelayUrl: string;
  windowWidth?: number | null;
  windowHeight?: number | null;
  windowMaximized?: boolean;
}

export interface TrackInfo {
  id: string;
  title: string;
  artist?: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  albumArtist?: string;
  coverArt?: string;
  coverUrl?: string;
  server?: string;
  duration?: number;
  format?: string;
  bitRate?: number;
  bitDepth?: number;
  samplingRate?: number;
  channelCount?: number;
  explicitStatus?: string;
}

export interface PlayerSnapshot {
  status: PlaybackStatus;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  replaygain: ReplayGainMode;
  buffering: boolean;
  track: TrackInfo | null;
}

export interface PersistedPlayerState {
  queue: Song[];
  baseQueue: Song[];
  currentIndex: number;
  position: number;
  shuffle: boolean;
  repeat: RepeatMode;
  savedAt: number;
}

export interface PositionEvent {
  position: number;
  duration: number;
}

export interface GainEvent {
  applied: number | null;
  mode: ReplayGainMode;
}

export interface WaveformData {
  peaks: number[];
  complete: boolean;
}

export interface WaveformEvent {
  trackId: string;
  peaks: number[];
  complete: boolean;
}

export interface AdvancedEvent {
  trackId: string;
}

export type SessionRole = "none" | "host" | "guest";
export type SyncStatus = "idle" | "synced" | "drifting" | "disconnected";

export interface SessionMember {
  id: string;
  name: string;
  isHost: boolean;
}

export interface SessionTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverArt?: string | null;
  duration: number;
}

export interface SessionSnapshot {
  role: SessionRole;
  code?: string | null;
  name: string;
  relayUrl: string;
  hostId?: string | null;
  members: SessionMember[];
  connected: boolean;
  sync: SyncStatus;
  driftMs?: number | null;
  nowPlaying?: SessionTrack | null;
  playing: boolean;
  error?: string | null;
}

export interface UiCommand {
  action: string;
  value?: string;
}


