import { create } from "zustand";

import { api } from "../lib/ipc";
import type {
  PlaybackStatus,
  PlayerSnapshot,
  RepeatMode,
  ReplayGainMode,
  Song,
  TrackInfo,
} from "../lib/types";

const SCROBBLE_THRESHOLD_MS = 30_000;

// Module-scoped scrobble bookkeeping (not reactive).
let scrobbleId: string | null = null;
let scrobbleStartedAt = 0;
let sleepTimeout: number | null = null;

function toTrack(song: Song): TrackInfo {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    albumArtist: song.albumArtist,
    coverArt: song.coverArt,
    duration: song.duration,
    format: song.suffix,
    bitRate: song.bitRate,
    bitDepth: song.bitDepth,
    samplingRate: song.samplingRate,
    channelCount: song.channelCount,
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
  waveforms: Record<string, number[]>;

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

  applySnapshot: (snapshot: PlayerSnapshot) => void;
  applyPosition: (position: number, duration: number) => void;
  onTrack: (track: TrackInfo | null) => void;
  onEnded: () => void;
  onError: (message: string) => void;
  setGain: (applied: number | null) => void;
  setWaveform: (trackId: string, peaks: number[]) => void;

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
    });

    void api.playerLoad(track).catch((err: unknown) => {
      set({ error: String(err), status: "stopped" });
    });

    void api
      .getWaveform(song.id)
      .then((peaks) => {
        if (peaks && peaks.length) get().setWaveform(song.id, peaks);
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
    },

    applyPosition: (position, duration) => {
      set((state) => ({
        position: Number.isFinite(position) ? position : state.position,
        duration: duration > 0 ? duration : state.duration,
      }));
    },

    onTrack: (track) => set((state) => ({ track: track ?? state.track })),

    onEnded: () => get().next(true),

    onError: (message) => set({ error: message, status: "stopped" }),

    setGain: (applied) => set({ gainApplied: applied }),

    setWaveform: (trackId, peaks) => {
      if (!trackId || !peaks.length) return;
      set((state) => {
        const waveforms = { ...state.waveforms, [trackId]: peaks };
        const keys = Object.keys(waveforms);
        if (keys.length > 24) {
          for (const key of keys.slice(0, keys.length - 24)) {
            delete waveforms[key];
          }
        }
        return { waveforms };
      });
    },

    toggle: () => {
      const { status, queue, currentIndex } = get();
      if (status === "playing") {
        void api.playerPause();
        set({ status: "paused" });
      } else if (status === "paused") {
        void api.playerPlay();
        set({ status: "playing" });
      } else if (queue.length) {
        loadIndex(currentIndex);
      }
    },

    play: () => {
      const { status, queue, currentIndex } = get();
      if (status === "paused") {
        void api.playerPlay();
        set({ status: "playing" });
      } else if (status === "stopped" && queue.length) {
        loadIndex(currentIndex);
      }
    },

    pause: () => {
      if (get().status !== "playing") return;
      void api.playerPause();
      set({ status: "paused" });
    },

    stop: () => {
      maybeSubmitScrobble();
      scrobbleId = null;
      void api.playerStop();
      set({ status: "stopped", position: 0, buffering: false });
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
      set({ position: target });
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
        return;
      }
      const nextQueue = [...queue];
      nextQueue.splice(currentIndex + 1, 0, song);
      const nextBase = [...baseQueue];
      const current = queue[currentIndex];
      const baseIndex = current ? nextBase.indexOf(current) : nextBase.length - 1;
      nextBase.splice(baseIndex + 1, 0, song);
      set({ queue: nextQueue, baseQueue: nextBase });
    },

    addToQueue: (song) => {
      const { queue, baseQueue } = get();
      set({
        queue: [...queue, song],
        baseQueue: [...baseQueue, song],
      });
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
        set({ queue: [], baseQueue: nextBase, currentIndex: 0, track: null });
        get().stop();
        return;
      }

      set({
        queue: nextQueue,
        baseQueue: nextBase,
        currentIndex: Math.max(0, nextIndex),
      });

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
    },

    clearQueue: () => {
      maybeSubmitScrobble();
      scrobbleId = null;
      set({
        queue: [],
        baseQueue: [],
        currentIndex: 0,
        track: null,
        status: "stopped",
        position: 0,
        duration: 0,
      });
      void api.playerStop();
    },

    setNowPlayingOpen: (open) => set({ nowPlayingOpen: open }),
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
      if (sleepTimeout != null) {
        window.clearTimeout(sleepTimeout);
        sleepTimeout = null;
      }

      if (minutes == null || minutes <= 0) {
        set({ sleepTimerEndsAt: null, sleepTimerMinutes: null });
        return;
      }

      const endsAt = Date.now() + minutes * 60_000;
      set({ sleepTimerEndsAt: endsAt, sleepTimerMinutes: minutes });

      sleepTimeout = window.setTimeout(
        () => {
          sleepTimeout = null;
          const state = get();
          if (
            state.sleepTimerEndsAt != null &&
            Date.now() >= state.sleepTimerEndsAt
          ) {
            set({ sleepTimerEndsAt: null, sleepTimerMinutes: null });
            state.pause();
          }
        },
        minutes * 60_000,
      );
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
