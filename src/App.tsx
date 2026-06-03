import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";
import { Shell } from "./components/layout/Shell";
import { pickAndOpen } from "./lib/openFile";
import { checkForUpdates } from "./lib/updater";
import { useMcpBridge } from "./mcp/bridge";
import { useAIStore } from "./store/aiStore";
import { useDocumentStore } from "./store/documentStore";
import { useSettingsStore } from "./store/settingsStore";
import { useUiStore } from "./store/uiStore";
import "./styles/themes.css";
import "./styles/global.css";
import "./styles/markdown.css";

const MD_EXT = /\.(md|markdown|mdown|mkd|mdx)$/i;

export default function App() {
  const openPath = useDocumentStore((s) => s.openPath);
  const theme = useSettingsStore((s) => s.theme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const contentWidth = useSettingsStore((s) => s.contentWidth);
  const [dragOver, setDragOver] = useState(false);

  // Bridge: mirror document/recents to Rust for MCP, and apply agent-driven
  // open / set-content / export events.
  useMcpBridge();

  // Apply theme + typography to the document root.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.setProperty("--content-font-size", `${fontSize}px`);
    root.style.setProperty("--content-width", `${contentWidth}px`);
  }, [theme, fontSize, contentWidth]);

  // Open files: drain anything buffered before mount, then listen for live opens.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const pending = await invoke<string[]>("take_pending_files").catch(
        () => [] as string[],
      );
      if (pending.length) openPath(pending[pending.length - 1]);
      unlisten = await listen<string[]>("file-opened", (e) => {
        const paths = e.payload;
        if (paths.length) openPath(paths[paths.length - 1]);
      });
    })();
    return () => unlisten?.();
  }, [openPath]);

  // Native drag-and-drop of files onto the window.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "over" || p.type === "enter") {
          setDragOver(true);
        } else if (p.type === "drop") {
          setDragOver(false);
          const md = p.paths.find((path) => MD_EXT.test(path)) ?? p.paths[0];
          if (md) openPath(md);
        } else {
          setDragOver(false);
        }
      });
    })();
    return () => unlisten?.();
  }, [openPath]);

  // ⌘O / Ctrl+O to open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        pickAndOpen();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        useSettingsStore.getState().cycleTheme();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        useDocumentStore.getState().save();
      } else if (mod && (e.key === "1" || e.key === "2" || e.key === "3")) {
        e.preventDefault();
        const mode = { "1": "read", "2": "edit", "3": "source" } as const;
        useDocumentStore.getState().setViewMode(mode[e.key]);
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useAIStore.getState().toggle();
      } else if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (useDocumentStore.getState().path) {
          useUiStore.getState().openExport();
        }
      } else if (mod && e.key === ",") {
        e.preventDefault();
        useUiStore.getState().openSettings();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // React to external (on-disk) changes of the open file.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<string>("file-changed", async (e) => {
        const changedPath = e.payload;
        const current = useDocumentStore.getState();
        if (current.path !== changedPath) return;
        try {
          const file = await invoke<{ content: string }>("read_markdown_file", {
            path: changedPath,
          });
          useDocumentStore.getState().handleDiskUpdate(file.content);
        } catch {
          /* file may be mid-write; the next event will settle it */
        }
      });
    })();
    return () => unlisten?.();
  }, []);

  // Check for updates shortly after launch (no-op in dev / offline).
  useEffect(() => {
    const t = setTimeout(() => {
      checkForUpdates();
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  return <Shell dragOver={dragOver} />;
}
