import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RecentFile {
  path: string;
  fileName: string;
  openedAt: number;
}

interface RecentState {
  recents: RecentFile[];
  add: (path: string, fileName: string, openedAt: number) => void;
  remove: (path: string) => void;
  clear: () => void;
}

const MAX_RECENTS = 12;

export const useRecentStore = create<RecentState>()(
  persist(
    (set) => ({
      recents: [],
      add: (path, fileName, openedAt) =>
        set((s) => ({
          recents: [
            { path, fileName, openedAt },
            ...s.recents.filter((r) => r.path !== path),
          ].slice(0, MAX_RECENTS),
        })),
      remove: (path) =>
        set((s) => ({ recents: s.recents.filter((r) => r.path !== path) })),
      clear: () => set({ recents: [] }),
    }),
    { name: "mdopener-recents" },
  ),
);
