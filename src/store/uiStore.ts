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
  outlineOpen: boolean;
  openOutline: () => void;
  closeOutline: () => void;
  toggleOutline: () => void;
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
  // Activity and Outline share the left dock and are mutually exclusive:
  // opening one closes the other.
  activityOpen: false,
  openActivity: () => set({ activityOpen: true, outlineOpen: false }),
  closeActivity: () => set({ activityOpen: false }),
  toggleActivity: () =>
    set((s) => ({ activityOpen: !s.activityOpen, outlineOpen: false })),
  outlineOpen: false,
  openOutline: () => set({ outlineOpen: true, activityOpen: false }),
  closeOutline: () => set({ outlineOpen: false }),
  toggleOutline: () =>
    set((s) => ({ outlineOpen: !s.outlineOpen, activityOpen: false })),
}));
