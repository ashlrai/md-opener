import { create } from "zustand";

interface UiState {
  exportOpen: boolean;
  openExport: () => void;
  closeExport: () => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  activityOpen: boolean;
  openActivity: () => void;
  closeActivity: () => void;
  toggleActivity: () => void;
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
  commandPaletteOpen: false,
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () =>
    set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  activityOpen: false,
  openActivity: () => set({ activityOpen: true }),
  closeActivity: () => set({ activityOpen: false }),
  toggleActivity: () => set((s) => ({ activityOpen: !s.activityOpen })),
}));
