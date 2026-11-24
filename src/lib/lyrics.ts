import type { LrcLine, Lyrics, LyricsMeta } from "./types";

/** Build the provider lookup metadata from a song or the current track. */
export function lyricsMeta(song: {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
}): LyricsMeta {
  return {
    title: song.title ?? null,
    artist: song.artist ?? null,
    album: song.album ?? null,
    duration: song.duration ?? null,
  };
}

/** Fired whenever locally saved lyrics change so open panels can refresh. */
export const LYRICS_CHANGED_EVENT = "hush:lyrics-changed";

// Shared cache for the read-only lyrics panel. Kept here (rather than inside
// the component) so saving from any route invalidates it even when the panel
// is not mounted.
const lyricsCache = new Map<string, Lyrics>();

export function cachedLyrics(trackId: string): Lyrics | undefined {
  return lyricsCache.get(trackId);
}

export function rememberLyrics(trackId: string, lyrics: Lyrics): void {
  lyricsCache.set(trackId, lyrics);
}

export function invalidateLyrics(trackId?: string): void {
  if (trackId) lyricsCache.delete(trackId);
  else lyricsCache.clear();
}

export function notifyLyricsChanged(trackId?: string): void {
  invalidateLyrics(trackId);
  window.dispatchEvent(
    new CustomEvent<string | undefined>(LYRICS_CHANGED_EVENT, {
      detail: trackId,
    }),
  );
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** Format milliseconds as `m:ss.cc`, the timestamp form used by LRC files. */
export function formatLrcTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const centis = Math.floor((safe % 1_000) / 10);
  return `${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
}

/**
 * Parse a timestamp typed by the user. Accepts `m:ss`, `m:ss.cc`,
 * `m:ss.ccc` and bare seconds. Returns milliseconds or null.
 */
export function parseLrcTime(input: string): number | null {
  const value = input.trim();
  if (!value) return null;

  const colon = value.indexOf(":");
  if (colon === -1) {
    const seconds = Number.parseFloat(value);
    return Number.isFinite(seconds) && seconds >= 0
      ? Math.round(seconds * 1000)
      : null;
  }

  const minutes = Number.parseInt(value.slice(0, colon), 10);
  const rest = value.slice(colon + 1);
  const [secondsPart, fractionPart] = rest.split(".");
  const seconds = Number.parseInt(secondsPart, 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;

  let millis = 0;
  if (fractionPart) {
    const digits = fractionPart.replace(/\D/g, "").slice(0, 3).padEnd(3, "0");
    const parsed = Number.parseInt(digits, 10);
    if (Number.isFinite(parsed)) millis = parsed;
  }

  return Math.max(0, minutes * 60_000 + seconds * 1_000 + millis);
}

/** Flatten server/local lyrics into editable lines (plain falls back to text). */
export function lyricsToLrcLines(lyrics: Lyrics | null): LrcLine[] {
  if (!lyrics) return [];
  if (lyrics.synced?.length) {
    return [...lyrics.synced]
      .sort((a, b) => a.startMs - b.startMs)
      .map((line) => ({ startMs: line.startMs, text: line.text }));
  }
  if (lyrics.plain) {
    return lyrics.plain
      .split(/\r?\n/)
      .map((text) => text.trimEnd())
      .filter((text, index, all) => text.length > 0 || index === all.length - 1)
      .map((text) => ({ startMs: null, text }));
  }
  return [];
}

/** Sort timed lines ascending, keeping untimed lines at the end. */
export function orderLrcLines<T extends LrcLine>(lines: T[]): T[] {
  const timed = lines
    .filter((line) => line.startMs != null)
    .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  const untimed = lines.filter((line) => line.startMs == null);
  return [...timed, ...untimed];
}

export function countUntimed(lines: LrcLine[]): number {
  return lines.reduce((total, line) => total + (line.startMs == null ? 1 : 0), 0);
}

/** True when timestamps are not in ascending order. */
export function isOutOfOrder(lines: LrcLine[]): boolean {
  let previous = -1;
  for (const line of lines) {
    if (line.startMs == null) continue;
    if (line.startMs < previous) return true;
    previous = line.startMs;
  }
  return false;
}
