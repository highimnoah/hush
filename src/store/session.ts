import { create } from "zustand";

import { api } from "../lib/ipc";
import type { SessionSnapshot } from "../lib/types";
import { usePlayer } from "./player";

interface SessionStore {
  snapshot: SessionSnapshot | null;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  setSnapshot: (snapshot: SessionSnapshot) => void;
  create: () => Promise<void>;
  join: (code: string) => Promise<void>;
  leave: () => Promise<void>;
}

export const useSession = create<SessionStore>((set) => ({
  snapshot: null,
  loading: false,
  error: null,

  load: async () => {
    try {
      const snapshot = await api.getSessionState();
      set({ snapshot });
    } catch {
      /* backend not ready */
    }
  },

  setSnapshot: (snapshot) =>
    set((state) => ({
      snapshot,
      loading:
        snapshot.role !== "none"
          ? false
          : snapshot.error
            ? false
            : state.loading,
      error: snapshot.error ?? null,
    })),

  create: async () => {
    set({ loading: true, error: null });
    try {
      await api.sessionCreate();
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  join: async (code) => {
    // The guest's local queue is not authoritative; clear it so a stale
    // queue cannot advance during the session.
    usePlayer.getState().clearQueue();
    set({ loading: true, error: null });
    try {
      await api.sessionJoin(code);
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  leave: async () => {
    set({ loading: true });
    try {
      await api.sessionLeave();
    } catch (err) {
      set({ loading: false, error: String(err) });
      return;
    }
    set({ loading: false, error: null });
  },
}));
