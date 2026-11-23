import { create } from "zustand";

import type { Song } from "../lib/types";

export interface ContextMenuPlaylistContext {
  playlistId: string;
  index: number;
  onChanged?: () => void;
}

interface ContextMenuStore {
  song: Song | null;
  x: number;
  y: number;
  playlist: ContextMenuPlaylistContext | null;
  open: (
    song: Song,
    x: number,
    y: number,
    playlist?: ContextMenuPlaylistContext | null,
  ) => void;
  close: () => void;
}

export const useContextMenu = create<ContextMenuStore>((set) => ({
  song: null,
  x: 0,
  y: 0,
  playlist: null,
  open: (song, x, y, playlist = null) => set({ song, x, y, playlist }),
  close: () => set({ song: null, playlist: null }),
}));
