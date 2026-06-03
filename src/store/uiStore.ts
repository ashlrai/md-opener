import { create } from "zustand";

interface UiState {
  exportOpen: boolean;
  openExport: () => void;
  closeExport: () => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

/**
 * Thin UI-flag store for transient overlay state that doesn't belong in
 * documentStore (file I/O) or settingsStore (persisted prefs).
 */
export const useUiStore = create<UiState>((set) => ({
  exportOpen: false,
  openExport: () => set({ exportOpen: true }),
  closeExport: () => set({ exportOpen: false }),
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
