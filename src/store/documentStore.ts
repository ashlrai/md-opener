import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useRecentStore } from "./recentStore";

export type ViewMode = "read" | "edit" | "source";

interface MarkdownFile {
  path: string;
  file_name: string;
  content: string;
  size: number;
}

interface DocumentState {
  path: string | null;
  fileName: string;
  /** Canonical, full document content (frontmatter + body). */
  content: string;
  /** Last content known to be on disk — basis for dirty + external-change checks. */
  diskContent: string;
  size: number;
  isLoading: boolean;
  error: string | null;
  viewMode: ViewMode;
  isDirty: boolean;
  /** Set when the file changed on disk while we hold unsaved edits. */
  externalChange: boolean;
  /** The on-disk content pending the user's reload/keep decision. */
  pendingDisk: string | null;
  /** Bumped to force editors to remount with fresh content (e.g. after reload). */
  reloadNonce: number;

  openPath: (path: string) => Promise<void>;
  setContent: (content: string) => void;
  setViewMode: (mode: ViewMode) => void;
  save: () => Promise<void>;
  handleDiskUpdate: (diskContent: string) => void;
  acceptExternalChange: () => void;
  dismissExternalChange: () => void;
  close: () => void;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  path: null,
  fileName: "",
  content: "",
  diskContent: "",
  size: 0,
  isLoading: false,
  error: null,
  viewMode: "read",
  isDirty: false,
  externalChange: false,
  pendingDisk: null,
  reloadNonce: 0,

  openPath: async (path) => {
    set({ isLoading: true, error: null });
    try {
      const file = await invoke<MarkdownFile>("read_markdown_file", { path });
      set((s) => ({
        path: file.path,
        fileName: file.file_name,
        content: file.content,
        diskContent: file.content,
        size: file.size,
        isLoading: false,
        error: null,
        isDirty: false,
        externalChange: false,
        pendingDisk: null,
        reloadNonce: s.reloadNonce + 1,
      }));
      useRecentStore.getState().add(file.path, file.file_name, Date.now());
      // Begin watching for external changes; failure is non-fatal.
      invoke("watch_file", { path: file.path }).catch(() => {});
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  setContent: (content) =>
    set((s) => ({ content, isDirty: content !== s.diskContent })),

  setViewMode: (viewMode) => set({ viewMode }),

  save: async () => {
    const { path, content } = get();
    if (!path) return;
    try {
      await invoke("write_markdown_file", { path, content });
      set({
        diskContent: content,
        isDirty: false,
        externalChange: false,
        pendingDisk: null,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // Called when the watcher reports the file changed on disk and we've re-read it.
  handleDiskUpdate: (disk) => {
    const s = get();
    if (!s.path) return;
    // Our own save (or no real change) — just resync the disk baseline.
    if (disk === s.content) {
      set({
        diskContent: disk,
        isDirty: false,
        externalChange: false,
        pendingDisk: null,
      });
      return;
    }
    if (s.isDirty) {
      // Conflict: keep the user's edits, surface a banner.
      set({ externalChange: true, pendingDisk: disk });
    } else {
      // No local edits — adopt the new content and remount editors.
      set((st) => ({
        content: disk,
        diskContent: disk,
        isDirty: false,
        reloadNonce: st.reloadNonce + 1,
      }));
    }
  },

  acceptExternalChange: () => {
    const { pendingDisk } = get();
    if (pendingDisk == null) {
      set({ externalChange: false });
      return;
    }
    set((s) => ({
      content: pendingDisk,
      diskContent: pendingDisk,
      isDirty: false,
      externalChange: false,
      pendingDisk: null,
      reloadNonce: s.reloadNonce + 1,
    }));
  },

  dismissExternalChange: () => set({ externalChange: false, pendingDisk: null }),

  close: () =>
    set({
      path: null,
      fileName: "",
      content: "",
      diskContent: "",
      size: 0,
      error: null,
      isDirty: false,
      externalChange: false,
      pendingDisk: null,
      viewMode: "read",
    }),
}));
