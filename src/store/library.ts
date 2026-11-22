import { create } from "zustand";

import { api } from "../lib/ipc";
import type { StarKind } from "../lib/types";
import { usePlayer } from "./player";

interface LibraryStore {
  stars: Record<string, boolean>;
  isStarred: (
    kind: StarKind,
    id: string,
    original?: string | boolean | null,
  ) => boolean;
  toggleStar: (
    kind: StarKind,
    id: string,
    currentlyStarred: boolean,
  ) => void;
}

export const useLibrary = create<LibraryStore>((set, get) => ({
  stars: {},

  isStarred: (kind, id, original) => {
    const override = get().stars[`${kind}:${id}`];
    if (override !== undefined) return override;
    if (typeof original === "string") return original.length > 0;
    return Boolean(original);
  },

  toggleStar: (kind, id, currentlyStarred) => {
    const key = `${kind}:${id}`;
    const next = !currentlyStarred;
    set((state) => ({ stars: { ...state.stars, [key]: next } }));

    void api.setStar(kind, id, next).catch((err: unknown) => {
      set((state) => ({ stars: { ...state.stars, [key]: !next } }));
      usePlayer.getState().onError(String(err));
    });
  },
}));
