import { create } from "zustand";

import type { Song } from "../lib/types";

interface ContextMenuStore {
  song: Song | null;
  x: number;
  y: number;
  open: (song: Song, x: number, y: number) => void;
  close: () => void;
}

export const useContextMenu = create<ContextMenuStore>((set) => ({
  song: null,
  x: 0,
  y: 0,
  open: (song, x, y) => set({ song, x, y }),
  close: () => set({ song: null }),
}));
