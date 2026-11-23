import { create } from "zustand";

let timer: number | null = null;

interface ToastStore {
  message: string | null;
  show: (message: string) => void;
  dismiss: () => void;
}

/** Lightweight, non-blocking success/info toast (separate from player errors). */
export const useToast = create<ToastStore>((set) => ({
  message: null,

  show: (message) => {
    if (timer != null) window.clearTimeout(timer);
    set({ message });
    timer = window.setTimeout(() => {
      timer = null;
      set({ message: null });
    }, 3200);
  },

  dismiss: () => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
    set({ message: null });
  },
}));
