import { create } from "zustand";

import { api } from "../lib/ipc";
import type { ServerInfo, Settings } from "../lib/types";

export type ConnectionState = "unknown" | "checking" | "ok" | "error";

interface SettingsStore {
  settings: Settings | null;
  loaded: boolean;
  loadError: string | null;
  connection: ConnectionState;
  connectionError: string | null;
  serverName: string;

  load: () => Promise<void>;
  save: (settings: Settings) => Promise<Settings>;
  /** Persist a small patch without re-checking the connection. */
  patch: (patch: Partial<Settings>) => Promise<Settings>;
  test: (settings: Settings) => Promise<ServerInfo>;
  checkConnection: () => Promise<void>;
}

export function isConfigured(settings: Settings | null): boolean {
  if (!settings) return false;
  const hasAuth =
    (settings.token.trim().length > 0 && settings.salt.trim().length > 0) ||
    settings.password.length > 0;
  return Boolean(
    settings.serverUrl.trim() && settings.username.trim() && hasAuth,
  );
}

function hostName(url: string): string {
  const trimmed = url.trim().replace(/^https?:\/\//, "");
  const host = trimmed.split("/")[0];
  return host || "Navidrome";
}

function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: null,
  loaded: false,
  loadError: null,
  connection: "unknown",
  connectionError: null,
  serverName: "Navidrome",

  load: async () => {
    try {
      const settings = await api.getSettings();
      set({
        settings,
        loaded: true,
        loadError: null,
        serverName: settings.serverName || hostName(settings.serverUrl),
      });
      if (isConfigured(settings)) {
        void get().checkConnection();
      }
    } catch (err) {
      set({ loaded: true, loadError: errorText(err) });
    }
  },

  save: async (settings) => {
    const saved = await api.updateSettings(settings);
    set({
      settings: saved,
      serverName: saved.serverName || hostName(saved.serverUrl),
    });
    void get().checkConnection();
    return saved;
  },

  patch: async (patch) => {
    const current = get().settings;
    if (!current) throw new Error("Settings not loaded");
    const saved = await api.updateSettings({ ...current, ...patch });
    set({
      settings: saved,
      serverName: saved.serverName || hostName(saved.serverUrl),
    });
    return saved;
  },

  test: (settings) => api.testConnection(settings),

  checkConnection: async () => {
    const settings = get().settings;
    if (!settings || !isConfigured(settings)) return;
    set({ connection: "checking", connectionError: null });
    try {
      const info = await api.testConnection(settings);
      set({
        connection: "ok",
        connectionError: null,
        serverName:
          settings.serverName ||
          info.name ||
          hostName(settings.serverUrl),
      });
    } catch (err) {
      set({ connection: "error", connectionError: errorText(err) });
    }
  },
}));
