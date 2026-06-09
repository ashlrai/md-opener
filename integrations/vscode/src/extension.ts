/**
 * Open in Ashlr MD — VS Code extension.
 *
 * Adds a command + editor title-bar button that opens the active Markdown
 * file in the Ashlr MD desktop app.
 *
 * Primary mechanism: the `mdopener://open?path=<encoded-absolute-path>` deep
 * link, opened via `vscode.env.openExternal`. Ashlr MD registers this custom
 * URL scheme and percent-decodes the `path` parameter (see
 * `src-tauri/src/deep_link.rs` + `src-tauri/bins/mdopen/src/main.rs`).
 *
 * Fallback: if the deep link cannot be opened, spawn the `mdopen <path>` CLI
 * (configurable via `ashlr-md.cliPath`, default `mdopen` on PATH).
 */

import { spawn } from "node:child_process";
import * as vscode from "vscode";

/** Markdown language ids VS Code uses for `.md` / `.markdown` files. */
const MARKDOWN_LANGUAGE_IDS = new Set(["markdown", "mdx"]);

/** Markdown file extensions accepted as a fallback when the language id is generic. */
const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".mdx"];

/**
 * Builds the `mdopener://open` deep link for an absolute path.
 *
 * The path is encoded with `encodeURIComponent`, matching the Obsidian
 * integration. Ashlr MD's handler percent-decodes the `path` parameter and
 * canonicalizes it, so encoding spaces/special characters here is both safe
 * and required for paths that contain them.
 */
export function buildDeepLink(absolutePath: string): string {
  return `mdopener://open?path=${encodeURIComponent(absolutePath)}`;
}

/** True when the document looks like a Markdown file we can hand off. */
function isMarkdownDocument(document: vscode.TextDocument): boolean {
  if (MARKDOWN_LANGUAGE_IDS.has(document.languageId)) {
    return true;
  }
  const lowerPath = document.uri.fsPath.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
}

/**
 * Fallback: spawn the `mdopen <path>` CLI. Resolves false if the process
 * cannot be spawned or exits non-zero, so the caller can surface an error.
 */
function openViaCli(cliPath: string, absolutePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };

    try {
      const child = spawn(cliPath, [absolutePath], {
        // Detach so the CLI's own URL launcher (open/xdg-open/start) is not
        // tied to VS Code's lifetime.
        stdio: "ignore",
      });
      child.on("error", () => done(false));
      child.on("close", (code) => done(code === 0 || code === null));
    } catch {
      done(false);
    }
  });
}

/**
 * Core command: open the active editor's Markdown file in Ashlr MD.
 */
async function openInAshlr(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage(
      "Ashlr MD: no active editor. Open a Markdown file first.",
    );
    return;
  }

  const document = editor.document;

  if (!isMarkdownDocument(document)) {
    vscode.window.showInformationMessage(
      "Ashlr MD: the active file is not a Markdown (.md / .markdown) file.",
    );
    return;
  }

  // Untitled / never-saved files have no on-disk path to hand off.
  if (document.isUntitled || document.uri.scheme !== "file") {
    vscode.window.showInformationMessage(
      "Ashlr MD: save the file to disk first, then open it in Ashlr MD.",
    );
    return;
  }

  // Use the on-disk path. Unsaved edits stay in VS Code; Ashlr MD opens the
  // last-saved version on disk (we intentionally do not auto-save here).
  const absolutePath = document.uri.fsPath;
  const deepLink = buildDeepLink(absolutePath);

  // Primary path: the mdopener:// deep link.
  try {
    const opened = await vscode.env.openExternal(vscode.Uri.parse(deepLink));
    if (opened) {
      return;
    }
  } catch {
    // Fall through to the CLI fallback.
  }

  // Fallback: spawn the `mdopen` CLI.
  const cliPath =
    vscode.workspace
      .getConfiguration("ashlr-md")
      .get<string>("cliPath")
      ?.trim() || "mdopen";

  const cliOpened = await openViaCli(cliPath, absolutePath);
  if (cliOpened) {
    return;
  }

  vscode.window.showErrorMessage(
    "Ashlr MD: could not open the file. Make sure Ashlr MD is installed " +
      "(https://md.ashlr.ai) so the mdopener:// scheme is registered, or set " +
      "`ashlr-md.cliPath` to your `mdopen` CLI.",
  );
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ashlr-md.openInAshlr", openInAshlr),
  );
}

export function deactivate(): void {
  // Nothing to clean up — all disposables are tracked in context.subscriptions.
}
