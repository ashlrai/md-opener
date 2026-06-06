import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Milkdown depends on ProseMirror (CJS); pre-bundle so dev doesn't choke.
  optimizeDeps: {
    include: [
      "prosemirror-model",
      "prosemirror-state",
      "prosemirror-view",
      "prosemirror-transform",
      "prosemirror-keymap",
      "prosemirror-commands",
      "prosemirror-inputrules",
      "prosemirror-history",
      "prosemirror-schema-list",
      "prosemirror-gapcursor",
    ],
  },

  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@milkdown") || id.includes("prosemirror")) {
            return "editor-milkdown";
          }
          if (id.includes("@codemirror") || id.includes("@lezer")) {
            return "editor-codemirror";
          }
          // NOTE: do NOT manualChunk shiki — it already dynamic-imports each
          // language grammar as its own chunk, so a doc only pulls the grammars
          // for the languages it actually uses. Lumping all of shiki into one
          // chunk would force every code block to load the entire ~9.5 MB
          // grammar set. Shiki's own dynamic imports keep this optimal.
          if (id.includes("katex")) {
            return "katex";
          }
          if (id.includes("mermaid")) {
            return "mermaid";
          }
          if (id.includes("html-to-docx")) {
            return "docx";
          }
          if (
            id.includes("react-markdown") ||
            id.includes("remark") ||
            id.includes("rehype") ||
            id.includes("micromark") ||
            id.includes("mdast") ||
            id.includes("unist") ||
            id.includes("hast")
          ) {
            return "markdown-core";
          }
          if (id.includes("react-dom")) {
            return "react";
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
