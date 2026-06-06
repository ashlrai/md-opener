/**
 * session.ts — restore the previous session on launch.
 *
 * Reopens the saved tabs (skipping any files that no longer exist on disk),
 * restores each tab's view mode, and re-activates the last-active document.
 */

import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "../store/documentStore";
import { useSessionStore } from "../store/sessionStore";

/** Reopen the previously-saved session. Returns the number of docs reopened. */
export async function restoreSession(): Promise<number> {
  const { savedTabs, activePath } = useSessionStore.getState();
  if (savedTabs.length === 0) return 0;

  // Filter to files that still exist (moved/deleted ones are silently dropped).
  // Fail SAFE on IPC error (restore nothing) rather than trying to open files
  // that may be gone and tripping the error state.
  const paths = savedTabs.map((t) => t.path);
  const existing = new Set(
    await invoke<string[]>("filter_existing", { paths }).catch(() => [] as string[]),
  );
  const toOpen = savedTabs.filter((t) => existing.has(t.path));

  // Every saved file is gone — clear the stale session so we don't retry forever.
  if (toOpen.length === 0) {
    useSessionStore.getState().clear();
    return 0;
  }

  for (const t of toOpen) {
    await useDocumentStore.getState().openPath(t.path);
    // Always correct the view mode: openPath inherits whatever the prior active
    // tab left in the top-level mirror, which may not match this tab's mode.
    useDocumentStore.getState().setViewMode(t.viewMode);
  }

  // Re-activate the last-active document.
  if (activePath && existing.has(activePath)) {
    const tab = useDocumentStore.getState().tabs.find((t) => t.path === activePath);
    if (tab) useDocumentStore.getState().switchTab(tab.id);
  }

  return toOpen.length;
}
