// Shared types mirroring the Rust DTOs (serde camelCase).

export type ReplayGainMode = "off" | "track" | "album";
export type RepeatMode = "off" | "one" | "all";
export type PlaybackStatus = "stopped" | "playing" | "paused";
export type StarKind = "song" | "album";

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
  discordEnabled: boolean;
  discordClientId: string;
  discordDetails: string;
  discordState: string;
  discordLargeImage: string;
  discordTimestamps: boolean;
  discordUseCover: boolean;
  accent: string;
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
  album?: string;
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

export interface PositionEvent {
  position: number;
  duration: number;
}

export interface GainEvent {
  applied: number | null;
  mode: ReplayGainMode;
}

export interface WaveformEvent {
  trackId: string;
  peaks: number[];
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

export const ACCENTS: Record<string, { label: string; color: string }> = {
  blue: { label: "Midnight blue", color: "#82aaff" },
  mint: { label: "Soft mint", color: "#8fe3c4" },
  rose: { label: "Dusty rose", color: "#f2a6c0" },
  amber: { label: "Warm amber", color: "#f2cf8f" },
  lavender: { label: "Lavender", color: "#b9a7ff" },
};
