/**
 * commands.ts — central command + keymap registry.
 *
 * This is the single source of truth for every user-invokable action in the
 * app. The command palette renders it, and App.tsx drives ALL global keyboard
 * shortcuts from it via the keymap engine, so a command's canonical shortcut
 * string lives in exactly one place.
 *
 * To add a feature's command(s): append a `Command` to the array returned by
 * `getCommands()` (see the EXTENSION POINT comment below). Carry a `when()`
 * predicate for availability and a `shortcut` string if it should bind a key.
 */

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useActivityStore } from "../store/activityStore";
import { useAIStore } from "../store/aiStore";
import { useDocumentStore } from "../store/documentStore";
import { THEMES, type ThemeId, useSettingsStore } from "../store/settingsStore";
import { useUiStore } from "../store/uiStore";
import { unwatchDirectory } from "./activity";
import { exportDocx, exportHtml, exportPdf } from "./export";
import { pickAndOpen } from "./openFile";

/**
 * Prompt for a folder and start watching it for agent Markdown activity.
 * The drawer's effects re-issue the OS watch + initial listing when the
 * watched folder changes, so this just needs to set it (and open the drawer).
 */
async function pickAndWatchFolder(): Promise<void> {
  const selected = await openDialog({ directory: true, multiple: false });
  if (typeof selected !== "string") return;
  await unwatchDirectory().catch(() => {});
  useActivityStore.getState().setWatchedDir(selected);
  useUiStore.getState().openActivity();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Command {
  /** Stable, unique id (also used as a React key). */
  id: string;
  /** Display title, e.g. "Switch to Read view". */
  title: string;
  /** Section heading the command is grouped under in the palette. */
  group: string;
  /** Optional secondary text shown muted beside/under the title. */
  hint?: string;
  /** Extra search terms for the fuzzy matcher (not displayed). */
  keywords?: string[];
  /**
   * Canonical shortcut string, e.g. "mod+k", "mod+1", "mod+shift+l".
   * Parsed by ../lib/keymap. Commands without one are palette-only.
   */
  shortcut?: string;
  /** Availability predicate. Defaults to always-available when omitted. */
  when?: () => boolean;
  /** Perform the action. */
  run: () => void | Promise<void>;
}

/** Section labels — exported so the palette can order groups deterministically. */
export const COMMAND_GROUPS = ["File", "View", "AI", "Appearance", "App"] as const;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Build the live command list from the current store state.
 *
 * Called fresh each time the palette opens (and by the global key handler),
 * so `when()` predicates and store getters always read current values. Store
 * actions are read via `getState()` so commands stay valid outside React.
 */
export function getCommands(): Command[] {
  const doc = useDocumentStore.getState;
  const ui = useUiStore.getState;
  const ai = useAIStore.getState;
  const settings = useSettingsStore.getState;

  const hasDoc = () => doc().path != null;

  const commands: Command[] = [
    // ── File ──────────────────────────────────────────────────────────────
    {
      id: "file.open",
      title: "Open file…",
      group: "File",
      keywords: ["open", "file", "browse"],
      shortcut: "mod+o",
      run: () => pickAndOpen(),
    },
    {
      id: "file.save",
      title: "Save",
      group: "File",
      keywords: ["save", "write", "disk"],
      shortcut: "mod+s",
      when: hasDoc,
      run: () => doc().save(),
    },
    {
      id: "file.export.html",
      title: "Export as HTML…",
      group: "File",
      keywords: ["export", "html", "share"],
      when: hasDoc,
      run: () => exportHtml(doc().fileName || "export"),
    },
    {
      id: "file.export.pdf",
      title: "Export as PDF…",
      group: "File",
      keywords: ["export", "pdf", "print", "share"],
      when: hasDoc,
      run: () => exportPdf(doc().fileName || "export"),
    },
    {
      id: "file.export.docx",
      title: "Export as Word…",
      group: "File",
      keywords: ["export", "docx", "word", "share"],
      when: hasDoc,
      run: () => exportDocx(doc().fileName || "export"),
    },
    {
      id: "file.export.dialog",
      title: "Export…",
      group: "File",
      hint: "Choose a format",
      keywords: ["export", "save as", "pdf", "html", "docx", "word"],
      shortcut: "mod+e",
      when: hasDoc,
      run: () => ui().openExport(),
    },
    {
      id: "file.close",
      title: "Close document",
      group: "File",
      keywords: ["close", "shut"],
      when: hasDoc,
      run: () => doc().close(),
    },

    // ── View ──────────────────────────────────────────────────────────────
    {
      id: "view.read",
      title: "Switch to Read view",
      group: "View",
      keywords: ["read", "preview", "render", "view"],
      shortcut: "mod+1",
      when: hasDoc,
      run: () => doc().setViewMode("read"),
    },
    {
      id: "view.edit",
      title: "Switch to Edit view",
      group: "View",
      keywords: ["edit", "wysiwyg", "write", "view"],
      shortcut: "mod+2",
      when: hasDoc,
      run: () => doc().setViewMode("edit"),
    },
    {
      id: "view.source",
      title: "Switch to Source view",
      group: "View",
      keywords: ["source", "raw", "markdown", "code", "view"],
      shortcut: "mod+3",
      when: hasDoc,
      run: () => doc().setViewMode("source"),
    },

    // ── AI ────────────────────────────────────────────────────────────────
    {
      id: "ai.toggle",
      title: "Toggle AI assistant",
      group: "AI",
      keywords: ["ai", "assistant", "chat", "sidebar", "copilot"],
      shortcut: "mod+l",
      run: () => ai().toggle(),
    },

    // ── Appearance ──────────────────────────────────────────────────────────
    {
      id: "theme.cycle",
      title: "Cycle theme",
      group: "Appearance",
      keywords: ["theme", "appearance", "dark", "light", "cycle"],
      shortcut: "mod+shift+l",
      run: () => settings().cycleTheme(),
    },
    ...THEMES.map(
      (t): Command => ({
        id: `theme.set.${t.id}`,
        title: `Set theme: ${t.label}`,
        group: "Appearance",
        keywords: ["theme", "appearance", t.label.toLowerCase()],
        when: () => settings().theme !== (t.id as ThemeId),
        run: () => settings().setTheme(t.id),
      }),
    ),

    // ── App ───────────────────────────────────────────────────────────────
    {
      id: "app.commandPalette",
      title: "Command palette",
      group: "App",
      keywords: ["command", "palette", "search", "menu"],
      shortcut: "mod+k",
      run: () => ui().toggleCommandPalette(),
    },
    {
      id: "app.settings",
      title: "Open settings",
      group: "App",
      keywords: ["settings", "preferences", "config", "options"],
      shortcut: "mod+,",
      run: () => ui().openSettings(),
    },

    // ── Agent Activity ────────────────────────────────────────────────────
    {
      id: "view.activity.toggle",
      title: "Toggle Agent Activity",
      group: "View",
      hint: "Live agent Markdown",
      keywords: ["activity", "agent", "watch", "drawer", "files", "live"],
      shortcut: "mod+b",
      run: () => ui().toggleActivity(),
    },
    {
      id: "file.activity.watch",
      title: "Watch a folder…",
      group: "File",
      hint: "Surface agent Markdown",
      keywords: ["watch", "folder", "activity", "agent", "monitor", "directory"],
      run: () => pickAndWatchFolder(),
    },

    // ── Outline ───────────────────────────────────────────────────────────
    {
      id: "view.outline.toggle",
      title: "Toggle Outline",
      group: "View",
      hint: "Document table of contents",
      keywords: ["outline", "toc", "table of contents", "headings", "navigate"],
      shortcut: "mod+shift+o",
      when: () => useDocumentStore.getState().path != null,
      run: () => ui().toggleOutline(),
    },

    // ── EXTENSION POINT ──────────────────────────────────────────────────
    // Future features append their commands here (or push onto this array
    // from their own module re-exported into getCommands). Planned:
    //   • New Tab        — "mod+t"
    //   • Toggle Activity— "mod+shift+a"
    // Each should carry a `when()` predicate and (optionally) a `shortcut`.

    // ── Tabs ──────────────────────────────────────────────────────────────
    {
      id: "tab.next",
      title: "Next tab",
      group: "View",
      keywords: ["tab", "next", "switch", "document", "cycle"],
      shortcut: "mod+shift+]",
      when: () => doc().tabs.length > 0,
      run: () => doc().nextTab(),
    },
    {
      id: "tab.prev",
      title: "Previous tab",
      group: "View",
      keywords: ["tab", "previous", "prev", "switch", "document", "cycle"],
      shortcut: "mod+shift+[",
      when: () => doc().tabs.length > 0,
      run: () => doc().prevTab(),
    },
    {
      id: "tab.close",
      title: "Close tab",
      group: "View",
      keywords: ["tab", "close", "shut", "document"],
      shortcut: "mod+w",
      when: () => doc().tabs.length > 0,
      run: () => doc().close(),
    },
  ];

  return commands;
}

/**
 * Commands that bind a global keyboard shortcut. Used by App.tsx to drive the
 * single keydown handler. The command palette toggle is included so ⌘K works
 * even while the palette is closed.
 */
export function getShortcutCommands(): Command[] {
  return getCommands().filter((c) => c.shortcut);
}
