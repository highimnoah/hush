import { create } from "zustand";

import { api } from "../lib/ipc";
import type {
  PersistedPlayerState,
  PlaybackStatus,
  PlayerSnapshot,
  RepeatMode,
  ReplayGainMode,
  SleepMode,
  Song,
  TrackInfo,
  WaveformData,
} from "../lib/types";
import { useSettings } from "./settings";

const SCROBBLE_THRESHOLD_MS = 30_000;
const SESSION_SAVE_DEBOUNCE_MS = 1_500;
const SESSION_SAVE_HEARTBEAT_MS = 5_000;

// Module-scoped scrobble bookkeeping (not reactive).
let scrobbleId: string | null = null;
let scrobbleStartedAt = 0;
let sleepTimeout: number | null = null;
let sleepFadeTimeout: number | null = null;

// Persistent-session bookkeeping (not reactive).
let sessionSaveTimer: number | null = null;
let sessionLastSavedAt = 0;
let sessionRestored = false;

// Gapless/fade boundary bookkeeping (not reactive).
let lastAdvancedAt = 0;

// Waveform on-demand requests already issued in this session (not reactive).
const requestedWaveforms = new Set<string>();

function toTrack(song: Song): TrackInfo {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    artistId: song.artistId,
    album: song.album,
    albumId: song.albumId,
    albumArtist: song.albumArtist,
    coverArt: song.coverArt,
    duration: song.duration,
    format: song.suffix,
    bitRate: song.bitRate,
    bitDepth: song.bitDepth,
    samplingRate: song.samplingRate,
    channelCount: song.channelCount,
    explicitStatus: song.explicitStatus,
  };
}

function shuffleArray<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function maybeSubmitScrobble(): void {
  if (!scrobbleId) return;
  const elapsed = Date.now() - scrobbleStartedAt;
  if (elapsed >= SCROBBLE_THRESHOLD_MS) {
    void api.scrobble(scrobbleId, true).catch(() => {});
  }
  scrobbleId = null;
}

function persistSession(get: () => PlayerStore): void {
  const state = get();
  if (!state.queue.length) return;
  sessionLastSavedAt = Date.now();
  const session: PersistedPlayerState = {
    queue: state.queue,
    baseQueue: state.baseQueue,
    currentIndex: state.currentIndex,
    position: state.position,
    shuffle: state.shuffle,
    repeat: state.repeat,
    savedAt: sessionLastSavedAt,
  };
  void api.savePlayerSession(session).catch(() => {});
}

function scheduleSessionSave(get: () => PlayerStore): void {
  if (sessionSaveTimer != null) window.clearTimeout(sessionSaveTimer);
  sessionSaveTimer = window.setTimeout(() => {
    sessionSaveTimer = null;
    persistSession(get);
  }, SESSION_SAVE_DEBOUNCE_MS);
}

function cancelScheduledSessionSave(): void {
  if (sessionSaveTimer != null) {
    window.clearTimeout(sessionSaveTimer);
    sessionSaveTimer = null;
  }
}

function heartbeatSessionSave(get: () => PlayerStore): void {
  if (Date.now() - sessionLastSavedAt >= SESSION_SAVE_HEARTBEAT_MS) {
    persistSession(get);
  }
}

function clearSleepTimers(): void {
  if (sleepTimeout != null) {
    window.clearTimeout(sleepTimeout);
    sleepTimeout = null;
  }
  if (sleepFadeTimeout != null) {
    window.clearTimeout(sleepFadeTimeout);
    sleepFadeTimeout = null;
  }
}

function armSleepQueueEnd(get: () => PlayerStore): void {
  const state = get();
  if (state.sleepMode !== "endOfQueue" || !state.queue.length) return;
  if (state.currentIndex >= state.queue.length - 1) {
    void api.playerSleepAtEnd(20).catch(() => {});
  }
}

function armSleepOnNewTrack(get: () => PlayerStore): void {
  const state = get();
  if (state.sleepMode === "endOfTrack") {
    void api.playerSleepAtEnd(20).catch(() => {});
  } else if (state.sleepMode === "endOfQueue") {
    armSleepQueueEnd(get);
  }
}

interface PlayerStore {
  status: PlaybackStatus;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  replaygain: ReplayGainMode;
  buffering: boolean;
  track: TrackInfo | null;
  gainApplied: number | null;
  waveforms: Record<string, WaveformData>;

  queue: Song[];
  baseQueue: Song[];
  currentIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;

  error: string | null;
  nowPlayingOpen: boolean;
  queueOpen: boolean;
  miniOpen: boolean;
  sleepTimerEndsAt: number | null;
  sleepTimerMinutes: number | null;
  sleepMode: SleepMode | null;
  /** Set when a queue was restored from disk and playback has not started yet. */
  restoredPosition: number | null;

  restoreSession: () => Promise<void>;
  resumeRestored: () => void;
  preloadNext: () => void;
  onAdvanced: (trackId: string) => void;
  setSleepMode: (mode: SleepMode | null) => void;

  applySnapshot: (snapshot: PlayerSnapshot) => void;
  applyPosition: (position: number, duration: number) => void;
  onTrack: (track: TrackInfo | null) => void;
  onEnded: () => void;
  onError: (message: string) => void;
  setGain: (applied: number | null) => void;
  setWaveform: (trackId: string, peaks: number[], complete: boolean) => void;
  ensureWaveform: (trackId: string, duration: number) => void;

  toggle: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (position: number) => void;
  seekRelative: (delta: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setShuffle: (shuffle: boolean) => void;
  cycleRepeat: () => void;
  setRepeat: (repeat: RepeatMode) => void;

  playSongs: (songs: Song[], startIndex?: number) => void;
  playShuffled: (songs: Song[], startIndex?: number) => void;
  playIndex: (index: number) => void;
  playNext: (song: Song) => void;
  addToQueue: (song: Song) => void;
  removeFromQueue: (index: number) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => void;

  setNowPlayingOpen: (open: boolean) => void;
  setQueueOpen: (open: boolean) => void;
  toggleMini: () => Promise<void>;
  setSleepTimer: (minutes: number | null) => void;
  clearError: () => void;
  init: () => Promise<void>;
}

export const usePlayer = create<PlayerStore>((set, get) => {
  const loadIndex = (index: number) => {
    const { queue } = get();
    const song = queue[index];
    if (!song) return;

    maybeSubmitScrobble();
    scrobbleId = song.id;
    scrobbleStartedAt = Date.now();
    void api.scrobble(song.id, false).catch(() => {});

    const track = toTrack(song);
    set({
      currentIndex: index,
      track,
      position: 0,
      duration: song.duration ?? 0,
      status: "playing",
      buffering: true,
      error: null,
      restoredPosition: null,
    });

    scheduleSessionSave(get);

    void api
      .playerLoad(track)
      .then(() => get().preloadNext())
      .catch((err: unknown) => {
        set({ error: String(err), status: "stopped" });
      });

    armSleepOnNewTrack(get);

    void api
      .getWaveform(song.id)
      .then((data) => {
        if (data?.peaks.length) {
          get().setWaveform(song.id, data.peaks, data.complete);
        }
      })
      .catch(() => {});
  };

  return {
    status: "stopped",
    position: 0,
    duration: 0,
    volume: 0.8,
    muted: false,
    replaygain: "off",
    buffering: false,
    track: null,
    gainApplied: null,
    waveforms: {},

    queue: [],
    baseQueue: [],
    currentIndex: 0,
    shuffle: false,
    repeat: "off",

    error: null,
    nowPlayingOpen: false,
    queueOpen: false,
    miniOpen: false,
    sleepTimerEndsAt: null,
    sleepTimerMinutes: null,
    sleepMode: null,
    restoredPosition: null,

    restoreSession: async () => {
      if (sessionRestored) return;
      sessionRestored = true;
      try {
        const saved = await api.getPlayerSession();
        if (!saved || !saved.queue.length) return;
        const index = Math.max(
          0,
          Math.min(saved.currentIndex ?? 0, saved.queue.length - 1),
        );
        const song = saved.queue[index];
        if (!song) return;

        const duration = song.duration ?? 0;
        const rawPosition = Number.isFinite(saved.position) ? saved.position : 0;
        const position =
          duration > 0
            ? Math.min(Math.max(0, rawPosition), duration)
            : Math.max(0, rawPosition);
        const shuffle = Boolean(saved.shuffle);
        const repeat: RepeatMode = saved.repeat ?? "off";

        set({
          queue: saved.queue,
          baseQueue: saved.baseQueue?.length ? saved.baseQueue : saved.queue,
          currentIndex: index,
          shuffle,
          repeat,
          track: toTrack(song),
          status: "paused",
          position,
          duration,
          restoredPosition: position,
          buffering: false,
          error: null,
        });

        void api.setPlaybackModes(shuffle, repeat).catch(() => {});

        if (useSettings.getState().settings?.resumePlayback) {
          get().resumeRestored();
        }
      } catch {
        /* no saved session */
      }
    },

    resumeRestored: () => {
      const { track, restoredPosition } = get();
      if (!track) return;
      const position = restoredPosition ?? 0;
      set({
        restoredPosition: null,
        status: "playing",
        buffering: true,
        error: null,
        position,
      });
      scheduleSessionSave(get);
      void api
        .playerLoad(track, position)
        .then(() => get().preloadNext())
        .catch((err: unknown) => {
          set({ error: String(err), status: "stopped", buffering: false });
        });
      armSleepOnNewTrack(get);
    },

    preloadNext: () => {
      const { queue, currentIndex, repeat } = get();
      if (!queue.length) {
        void api.playerClearPreload().catch(() => {});
        return;
      }

      let nextIndex: number | null = null;
      if (repeat === "one") {
        nextIndex = currentIndex;
      } else {
        let candidate = currentIndex + 1;
        if (candidate >= queue.length) {
          candidate = repeat === "all" ? 0 : -1;
        }
        nextIndex = candidate >= 0 ? candidate : null;
      }

      const song = nextIndex == null ? null : queue[nextIndex];
      if (!song) {
        void api.playerClearPreload().catch(() => {});
        return;
      }

      void api.playerPreload(toTrack(song)).catch(() => {});
    },

    onAdvanced: (trackId) => {
      const state = get();
      maybeSubmitScrobble();
      scrobbleId = trackId || null;
      scrobbleStartedAt = Date.now();
      if (trackId) void api.scrobble(trackId, false).catch(() => {});

      // Prefer the next occurrence after the current index so duplicate ids
      // in a queue resolve to the entry the engine actually advanced to.
      let index = -1;
      const current = state.queue[state.currentIndex];
      if (current && current.id === trackId) {
        index = state.currentIndex;
      } else if (state.queue.length) {
        for (let offset = 1; offset <= state.queue.length; offset += 1) {
          const candidate = (state.currentIndex + offset) % state.queue.length;
          if (state.queue[candidate]?.id === trackId) {
            index = candidate;
            break;
          }
        }
        if (index < 0) {
          index = state.queue.findIndex((song) => song.id === trackId);
        }
      }

      const nextIndex = index >= 0 ? index : state.currentIndex;
      const song = state.queue[nextIndex];
      lastAdvancedAt = Date.now();

      set({
        currentIndex: nextIndex,
        position: 0,
        duration: song?.duration ?? state.duration,
        status: "playing",
        buffering: false,
        restoredPosition: null,
      });

      if (trackId) {
        void api
          .getWaveform(trackId)
          .then((data) => {
            if (data?.peaks.length) {
              get().setWaveform(trackId, data.peaks, data.complete);
            }
          })
          .catch(() => {});
      }

      scheduleSessionSave(get);
      get().preloadNext();
      armSleepOnNewTrack(get);
    },

    applySnapshot: (snapshot) => {
      set((state) => ({
        status: snapshot.status,
        position: Number.isFinite(snapshot.position)
          ? snapshot.position
          : state.position,
        duration:
          snapshot.duration > 0
            ? snapshot.duration
            : snapshot.track
              ? state.duration
              : 0,
        volume: snapshot.volume,
        muted: snapshot.muted,
        replaygain: snapshot.replaygain,
        buffering: snapshot.buffering,
        track: snapshot.track,
      }));

      // The engine pauses itself when a sleep fade completes; clear the mode.
      const current = get();
      if (current.sleepMode != null && snapshot.status === "paused") {
        const reachedEnd =
          current.sleepMode !== "minutes" ||
          (current.sleepTimerEndsAt != null &&
            Date.now() >= current.sleepTimerEndsAt - 25_000);
        if (reachedEnd) {
          clearSleepTimers();
          set({
            sleepMode: null,
            sleepTimerEndsAt: null,
            sleepTimerMinutes: null,
          });
        }
      }
    },

    applyPosition: (position, duration) => {
      set((state) => ({
        position: Number.isFinite(position) ? position : state.position,
        duration: duration > 0 ? duration : state.duration,
      }));
      if (get().status === "playing") heartbeatSessionSave(get);
    },

    onTrack: (track) => set((state) => ({ track: track ?? state.track })),

    onEnded: () => {
      // An engine-side advance already moved the queue; a late EOS message
      // from the old item must not advance again.
      if (Date.now() - lastAdvancedAt < 1_500) return;
      get().next(true);
    },

    onError: (message) => set({ error: message, status: "stopped" }),

    setGain: (applied) => set({ gainApplied: applied }),

    setWaveform: (trackId, peaks, complete) => {
      if (!trackId || !peaks.length) return;
      set((state) => {
        const existing = state.waveforms[trackId];
        const merged =
          existing && existing.peaks.length > peaks.length
            ? existing.peaks
            : peaks;
        const waveforms = {
          ...state.waveforms,
          [trackId]: {
            peaks: merged,
            complete: complete || Boolean(existing?.complete),
          } satisfies WaveformData,
        };
        const keys = Object.keys(waveforms);
        if (keys.length > 64) {
          for (const key of keys.slice(0, keys.length - 64)) {
            delete waveforms[key];
          }
        }
        return { waveforms };
      });
    },

    ensureWaveform: (trackId, duration) => {
      if (!trackId || duration <= 0) return;
      const existing = get().waveforms[trackId];
      if (existing?.complete) return;
      if (requestedWaveforms.has(trackId)) return;
      requestedWaveforms.add(trackId);
      void api
        .ensureWaveform(trackId, duration)
        .then((data) => {
          if (data?.peaks.length) {
            get().setWaveform(trackId, data.peaks, data.complete);
          }
        })
        .catch(() => {
          requestedWaveforms.delete(trackId);
        });
    },

    toggle: () => {
      const { status, queue, currentIndex, restoredPosition, track } = get();
      if (status === "playing") {
        void api.playerPause();
        set({ status: "paused" });
        scheduleSessionSave(get);
      } else if (status === "paused") {
        if (restoredPosition != null && track) {
          get().resumeRestored();
          return;
        }
        void api.playerPlay();
        set({ status: "playing" });
        scheduleSessionSave(get);
      } else if (queue.length) {
        loadIndex(currentIndex);
      }
    },

    play: () => {
      const { status, queue, currentIndex, restoredPosition, track } = get();
      if (status === "paused") {
        if (restoredPosition != null && track) {
          get().resumeRestored();
          return;
        }
        void api.playerPlay();
        set({ status: "playing" });
        scheduleSessionSave(get);
      } else if (status === "stopped" && queue.length) {
        loadIndex(currentIndex);
      }
    },

    pause: () => {
      if (get().status !== "playing") return;
      void api.playerPause();
      set({ status: "paused" });
      scheduleSessionSave(get);
    },

    stop: () => {
      maybeSubmitScrobble();
      scrobbleId = null;
      void api.playerStop();
      void api.playerClearPreload().catch(() => {});
      set({ status: "stopped", position: 0, buffering: false });
      if (get().queue.length) scheduleSessionSave(get);
    },

    next: (auto = false) => {
      const { queue, currentIndex, repeat } = get();
      if (!queue.length) return;
      if (auto && repeat === "one") {
        get().seek(0);
        get().play();
        return;
      }
      let nextIndex = currentIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeat === "all") {
          nextIndex = 0;
        } else {
          get().stop();
          return;
        }
      }
      loadIndex(nextIndex);
    },

    prev: () => {
      const { position, currentIndex, queue, repeat } = get();
      if (!queue.length) return;
      if (position > 3) {
        get().seek(0);
        return;
      }
      let prevIndex = currentIndex - 1;
      if (prevIndex < 0) {
        if (repeat === "all") {
          prevIndex = queue.length - 1;
        } else {
          get().seek(0);
          return;
        }
      }
      loadIndex(prevIndex);
    },

    seek: (position) => {
      const duration = get().duration;
      const target = Math.max(
        0,
        duration > 0 ? Math.min(position, duration) : position,
      );
      void api.playerSeek(target);
      const restored = get().restoredPosition;
      set(
        restored != null
          ? { position: target, restoredPosition: target }
          : { position: target },
      );
      scheduleSessionSave(get);
      armSleepOnNewTrack(get);
    },

    seekRelative: (delta) => {
      get().seek(get().position + delta);
    },

    setVolume: (volume) => {
      const value = Math.max(0, Math.min(1, volume));
      const wasMuted = get().muted;
      set({ volume: value, muted: false });
      void api.playerSetVolume(value);
      if (wasMuted) void api.playerSetMute(false);
    },

    toggleMute: () => {
      const muted = !get().muted;
      set({ muted });
      void api.playerSetMute(muted);
    },

    setShuffle: (shuffle) => {
      const state = get();
      if (shuffle === state.shuffle) return;

      const current = state.queue[state.currentIndex] ?? null;

      if (shuffle) {
        const rest = state.queue.filter((song) => song !== current);
        shuffleArray(rest);
        const queue = current ? [current, ...rest] : rest;
        set({ shuffle: true, queue, currentIndex: 0 });
      } else {
        const base = [...state.baseQueue];
        let index = current ? base.indexOf(current) : 0;
        if (index < 0) {
          if (current) {
            base.push(current);
            index = base.length - 1;
          } else {
            index = 0;
          }
        }
        set({
          shuffle: false,
          queue: base,
          currentIndex: Math.max(0, index),
        });
      }

      void api.setPlaybackModes(shuffle, get().repeat);
      scheduleSessionSave(get);
      get().preloadNext();
    },

    cycleRepeat: () => {
      const order: RepeatMode[] = ["off", "all", "one"];
      const current = get().repeat;
      const next = order[(order.indexOf(current) + 1) % order.length];
      get().setRepeat(next);
    },

    setRepeat: (repeat) => {
      set({ repeat });
      void api.setPlaybackModes(get().shuffle, repeat);
      scheduleSessionSave(get);
      get().preloadNext();
    },

    playSongs: (songs, startIndex = 0) => {
      if (!songs.length) return;
      const { shuffle } = get();
      let queue = [...songs];
      let index = Math.max(0, Math.min(startIndex, songs.length - 1));

      if (shuffle && songs.length > 1) {
        const first = songs[index];
        const rest = songs.filter((_, i) => i !== index);
        shuffleArray(rest);
        queue = [first, ...rest];
        index = 0;
      }

      set({ queue, baseQueue: [...songs], currentIndex: index });
      loadIndex(index);
    },

    playShuffled: (songs, startIndex = 0) => {
      if (!songs.length) return;
      const index = Math.max(0, Math.min(startIndex, songs.length - 1));
      const first = songs[index];
      const rest = songs.filter((_, i) => i !== index);
      shuffleArray(rest);
      set({
        shuffle: true,
        queue: [first, ...rest],
        baseQueue: [...songs],
        currentIndex: 0,
      });
      void api.setPlaybackModes(true, get().repeat);
      loadIndex(0);
    },

    playIndex: (index) => loadIndex(index),

    playNext: (song) => {
      const { queue, baseQueue, currentIndex } = get();
      if (!queue.length) {
        set({ queue: [song], baseQueue: [song], currentIndex: 0 });
        scheduleSessionSave(get);
        get().preloadNext();
        return;
      }
      const nextQueue = [...queue];
      nextQueue.splice(currentIndex + 1, 0, song);
      const nextBase = [...baseQueue];
      const current = queue[currentIndex];
      const baseIndex = current ? nextBase.indexOf(current) : nextBase.length - 1;
      nextBase.splice(baseIndex + 1, 0, song);
      set({ queue: nextQueue, baseQueue: nextBase });
      scheduleSessionSave(get);
      get().preloadNext();
    },

    addToQueue: (song) => {
      const { queue, baseQueue } = get();
      set({
        queue: [...queue, song],
        baseQueue: [...baseQueue, song],
      });
      scheduleSessionSave(get);
      get().preloadNext();
    },

    removeFromQueue: (index) => {
      const { queue, baseQueue, currentIndex } = get();
      if (index < 0 || index >= queue.length) return;
      const removed = queue[index];
      const nextQueue = queue.filter((_, i) => i !== index);
      const nextBase = baseQueue.filter((song) => song !== removed);

      let nextIndex = currentIndex;
      if (index < currentIndex) nextIndex = currentIndex - 1;
      else if (index === currentIndex) nextIndex = Math.min(index, nextQueue.length - 1);

      if (!nextQueue.length) {
        cancelScheduledSessionSave();
        void api.clearPlayerSession().catch(() => {});
        void api.playerClearPreload().catch(() => {});
        set({
          queue: [],
          baseQueue: nextBase,
          currentIndex: 0,
          track: null,
          restoredPosition: null,
        });
        get().stop();
        return;
      }

      set({
        queue: nextQueue,
        baseQueue: nextBase,
        currentIndex: Math.max(0, nextIndex),
      });
      scheduleSessionSave(get);
      get().preloadNext();

      if (index === currentIndex) {
        loadIndex(Math.min(index, nextQueue.length - 1));
      }
    },

    moveInQueue: (from, to) => {
      const { queue, baseQueue, currentIndex, shuffle } = get();
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= queue.length ||
        to >= queue.length
      ) {
        return;
      }

      const nextQueue = [...queue];
      const [item] = nextQueue.splice(from, 1);
      nextQueue.splice(to, 0, item);

      let nextIndex = currentIndex;
      if (from === currentIndex) nextIndex = to;
      else if (from < currentIndex && to >= currentIndex) nextIndex -= 1;
      else if (from > currentIndex && to <= currentIndex) nextIndex += 1;

      if (!shuffle) {
        set({ queue: nextQueue, baseQueue: [...nextQueue], currentIndex: nextIndex });
      } else {
        set({ queue: nextQueue, baseQueue, currentIndex: nextIndex });
      }
      scheduleSessionSave(get);
      get().preloadNext();
    },

    clearQueue: () => {
      maybeSubmitScrobble();
      scrobbleId = null;
      cancelScheduledSessionSave();
      void api.clearPlayerSession().catch(() => {});
      void api.playerClearPreload().catch(() => {});
      void api.playerCancelSleep().catch(() => {});
      set({
        queue: [],
        baseQueue: [],
        currentIndex: 0,
        track: null,
        status: "stopped",
        position: 0,
        duration: 0,
        restoredPosition: null,
        sleepMode: null,
        sleepTimerEndsAt: null,
        sleepTimerMinutes: null,
      });
      clearSleepTimers();
      void api.playerStop();
    },

    setNowPlayingOpen: (open) =>
      set(open ? { nowPlayingOpen: true, queueOpen: false } : { nowPlayingOpen: false }),
    setQueueOpen: (open) => set({ queueOpen: open }),

    toggleMini: async () => {
      const open = !get().miniOpen;
      set({ miniOpen: open });
      try {
        await api.toggleMiniPlayer(open);
      } catch {
        set({ miniOpen: !open });
      }
    },

    setSleepTimer: (minutes) => {
      clearSleepTimers();
      void api.playerCancelSleep().catch(() => {});

      if (minutes == null || minutes <= 0) {
        set({ sleepTimerEndsAt: null, sleepTimerMinutes: null, sleepMode: null });
        return;
      }

      const endsAt = Date.now() + minutes * 60_000;
      set({
        sleepTimerEndsAt: endsAt,
        sleepTimerMinutes: minutes,
        sleepMode: "minutes",
      });

      // Start a gentle 20 s fade slightly before the deadline; the engine
      // pauses itself when the ramp completes.
      const fadeDelay = Math.max(0, endsAt - Date.now() - 20_000);
      sleepFadeTimeout = window.setTimeout(() => {
        sleepFadeTimeout = null;
        if (get().sleepTimerEndsAt === endsAt) {
          void api.playerFadeOut(20, true).catch(() => {});
        }
      }, fadeDelay);

      sleepTimeout = window.setTimeout(
        () => {
          sleepTimeout = null;
          const state = get();
          if (state.sleepTimerEndsAt === endsAt) {
            set({
              sleepTimerEndsAt: null,
              sleepTimerMinutes: null,
              sleepMode: null,
            });
            state.pause();
          }
        },
        Math.max(0, endsAt - Date.now()),
      );
    },

    setSleepMode: (mode) => {
      clearSleepTimers();
      void api.playerCancelSleep().catch(() => {});

      if (mode == null) {
        set({
          sleepMode: null,
          sleepTimerEndsAt: null,
          sleepTimerMinutes: null,
        });
        return;
      }

      set({
        sleepMode: mode,
        sleepTimerEndsAt: null,
        sleepTimerMinutes: null,
      });

      if (mode === "endOfTrack") {
        void api.playerSleepAtEnd(20).catch(() => {});
      } else if (mode === "endOfQueue") {
        armSleepQueueEnd(get);
      }
    },

    clearError: () => set({ error: null }),

    init: async () => {
      try {
        const snapshot = await api.getPlayerState();
        get().applySnapshot(snapshot);
      } catch {
        /* backend not ready */
      }
    },
  };
});
