export function formatTime(totalSeconds: number | undefined | null): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatBitrate(bitRate: number | undefined | null): string | null {
  if (!bitRate || !Number.isFinite(bitRate)) return null;
  if (bitRate >= 1000) {
    const mbps = (bitRate / 1000).toFixed(1);
    return `${mbps} Mbps`;
  }
  return `${Math.round(bitRate)} kbps`;
}

export function formatSampleRate(rate: number | undefined | null): string | null {
  if (!rate || !Number.isFinite(rate)) return null;
  if (rate % 1000 === 0) return `${(rate / 1000).toFixed(1)} kHz`;
  return `${(rate / 1000).toFixed(1)} kHz`;
}

export function formatBytes(bytes: number | undefined | null): string | null {
  if (!bytes || !Number.isFinite(bytes)) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(
  seconds: number | undefined | null,
  long = false,
): string {
  if (!seconds || !Number.isFinite(seconds)) return long ? "0 minutes" : "0 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return long ? `${minutes} minutes` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return long ? `${hours} hr ${rest} min` : `${hours} hr ${rest} min`;
}

export function formatFormat(suffix: string | undefined | null): string | null {
  if (!suffix) return null;
  const normalized = suffix.toUpperCase();
  const map: Record<string, string> = {
    MPEG: "MP3",
    MP3: "MP3",
    FLAC: "FLAC",
    M4A: "M4A",
    MP4: "M4A",
    AAC: "AAC",
    OGG: "OGG",
    OPUS: "OPUS",
    WAV: "WAV",
    WV: "WAVPACK",
    WMA: "WMA",
    AIFF: "AIFF",
    ALAC: "ALAC",
  };
  return map[normalized] ?? normalized;
}

export function formatTotalDuration(seconds: number | undefined | null): string {
  return formatDuration(seconds, false);
}

export function trackKey(id: string, index: number): string {
  return `${id}:${index}`;
}
