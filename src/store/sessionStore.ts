/**
 * sessionStore.ts — "continue where you left off".
 *
 * Persists ONLY lightweight tab descriptors (path + view mode) and the active
 * path — never content, dirty state, or scroll. On relaunch these are re-opened
 * from disk (see lib/session.ts). Content is always re-read fresh, consistent
 * with how activityStore persists only the watched dir.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewMode } from "./documentStore";

export interface SavedTab {
  path: string;
  viewMode: ViewMode;
}

interface SessionState {
  savedTabs: SavedTab[];
  activePath: string | null;
  /** Mirror the live tab set into the persisted session. */
  save: (tabs: SavedTab[], activePath: string | null) => void;
  clear: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      savedTabs: [],
      activePath: null,
      save: (savedTabs, activePath) => set({ savedTabs, activePath }),
      clear: () => set({ savedTabs: [], activePath: null }),
    }),
    { name: "mdopener-session" },
  ),
);
