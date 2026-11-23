import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";

import { api } from "../lib/ipc";
import { useToast } from "./toast";

const SKIP_KEY = "hush.skippedUpdateVersion";
const RELEASES_URL = "https://github.com/highimnoah/hush/releases";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "up-to-date"
  | "error";

interface UpdaterStore {
  status: UpdateStatus;
  supported: boolean;
  currentVersion: string | null;
  version: string | null;
  notes: string | null;
  progress: number;
  error: string | null;
  promptOpen: boolean;

  loadVersion: () => Promise<void>;
  check: (manual?: boolean) => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  skip: () => void;
  openPrompt: () => void;
  dismiss: () => void;
  openReleases: () => Promise<void>;
}

let pending: Update | null = null;

export const useUpdater = create<UpdaterStore>((set, get) => ({
  status: "idle",
  supported: true,
  currentVersion: null,
  version: null,
  notes: null,
  progress: 0,
  error: null,
  promptOpen: false,

  loadVersion: async () => {
    try {
      set({ currentVersion: await getVersion() });
    } catch {
      // Version display is cosmetic; ignore failures.
    }
    try {
      set({ supported: await api.updaterSupported() });
    } catch {
      // Older builds / non-Tauri contexts: keep the optimistic default.
    }
  },

  check: async (manual = false) => {
    // Dev builds should never replace themselves with a packaged release.
    if (!import.meta.env.PROD) {
      if (manual) {
        useToast
          .getState()
          .show("Updates are disabled in development builds.");
      }
      return;
    }

    if (!get().supported) {
      if (manual) {
        useToast
          .getState()
          .show(
            "Automatic updates are for the Windows installer and the Linux AppImage. Download the .deb from GitHub Releases.",
          );
      }
      return;
    }

    const status = get().status;
    if (status === "checking" || status === "downloading") return;

    set({ status: "checking", error: null });

    try {
      const update = await check();

      if (!update) {
        set({
          status: "up-to-date",
          version: null,
          notes: null,
          promptOpen: false,
        });
        if (manual) useToast.getState().show("hush is up to date.");
        return;
      }

      const skipped = localStorage.getItem(SKIP_KEY);
      if (!manual && skipped === update.version) {
        set({
          status: "idle",
          version: update.version,
          notes: update.body ?? null,
          promptOpen: false,
        });
        return;
      }

      pending = update;
      set({
        status: "available",
        version: update.version,
        notes: update.body ?? null,
        progress: 0,
        promptOpen: true,
      });
    } catch (err) {
      set({
        status: "error",
        error: String(err),
        promptOpen: manual,
      });
      if (manual) {
        useToast.getState().show("Could not check for updates.");
      }
    }
  },

  download: async () => {
    const update = pending;
    if (!update || get().status === "downloading") return;

    set({ status: "downloading", progress: 0, error: null });

    try {
      let total = 0;
      let downloaded = 0;

      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          set({ progress: total > 0 ? 0 : -1 });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          set({
            progress:
              total > 0 ? Math.min(100, (downloaded / total) * 100) : -1,
          });
        } else if (event.event === "Finished") {
          set({ progress: 100 });
        }
      });

      set({ status: "ready", progress: 100, promptOpen: true });
    } catch (err) {
      set({
        status: "error",
        error: String(err),
        promptOpen: true,
      });
    }
  },

  install: async () => {
    const update = pending;
    if (!update || get().status === "installing") return;

    // On Windows the installer closes the app; on Linux the AppImage is
    // replaced and we relaunch below.
    set({ status: "installing", promptOpen: true });
    try {
      await update.install();
      await relaunch();
    } catch (err) {
      set({ status: "error", error: String(err), promptOpen: true });
    }
  },

  skip: () => {
    const version = get().version;
    if (version) {
      try {
        localStorage.setItem(SKIP_KEY, version);
      } catch {
        // Private mode / storage disabled: just close the prompt.
      }
    }
    set({ promptOpen: false, status: "idle" });
  },

  openPrompt: () => {
    if (get().version) set({ promptOpen: true });
  },

  dismiss: () => set({ promptOpen: false }),

  openReleases: async () => {
    try {
      await openUrl(RELEASES_URL);
    } catch {
      // Ignore: the URL is also shown in settings.
    }
  },
}));
