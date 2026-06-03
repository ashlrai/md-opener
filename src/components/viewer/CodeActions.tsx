/**
 * CodeActions.tsx
 *
 * Renders the header action buttons for code blocks:
 *   - Copy button (all languages)
 *   - Run button (bash / sh / zsh only) — shows a confirm dialog, then fires
 *     the `onRun(cmd)` callback. The actual shell execution is the integrator's
 *     responsibility via a Tauri command (see INTEGRATION notes below).
 *
 * Usage inside CodeBlock.tsx:
 *   <CodeActions code={code} lang={lang} onRun={handleRun} />
 *
 * ─── INTEGRATION NOTE ────────────────────────────────────────────────────────
 * To wire the Run button to the system shell, add to src-tauri/src/lib.rs:
 *
 *   // TODO(integrator): add tauri-plugin-shell to Cargo.toml and Tauri config,
 *   // then replace this stub with a real shell spawn.
 *   #[tauri::command]
 *   async fn run_shell(cmd: String) -> Result<String, String> {
 *     // stub — replace with tauri_plugin_shell::open or Command::new("sh")
 *     Err(format!("run_shell not yet implemented: {cmd}"))
 *   }
 *
 * And register it in the builder:
 *   .invoke_handler(tauri::generate_handler![run_shell, …])
 *
 * In CodeBlock.tsx, the onRun handler would be:
 *   async function handleRun(cmd: string) {
 *     await invoke("run_shell", { cmd });
 *   }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type MouseEvent, useCallback, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Languages for which the Run button is shown. */
const RUNNABLE_LANGS = new Set(["bash", "sh", "zsh", "shell"]);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CodeActionsProps {
  /** The raw code string (used for Copy and passed to onRun). */
  code: string;
  /** Language identifier (lowercased). */
  lang: string;
  /**
   * Called after the user confirms they want to run the command.
   * The integrator wires this to `invoke("run_shell", { cmd })`.
   * If undefined, the Run button is still shown but logs a console warning.
   */
  onRun?: (cmd: string) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodeActions({ code, lang, onRun }: CodeActionsProps) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);

  const isRunnable = RUNNABLE_LANGS.has(lang);

  // ── Copy ──────────────────────────────────────────────────────────────────

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }, [code]);

  // ── Run (confirm phase) ───────────────────────────────────────────────────

  const handleRunClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    setConfirming(true);
  }, []);

  const handleConfirm = useCallback(async () => {
    setConfirming(false);
    setRunning(true);
    try {
      if (onRun) {
        await onRun(code);
      } else {
        console.warn(
          "[CodeActions] Run button clicked but no onRun handler was provided. " +
            "Wire invoke('run_shell', { cmd }) via the onRun prop.",
        );
      }
    } finally {
      setRunning(false);
    }
  }, [code, onRun]);

  const handleCancel = useCallback(() => {
    setConfirming(false);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="code-actions">
      {/* Run button — only for shell languages */}
      {isRunnable && !confirming && (
        <button
          className={`run-btn${running ? " running" : ""}`}
          onClick={handleRunClick}
          type="button"
          disabled={running}
          title="Run this command in shell"
        >
          {running ? (
            <>
              <span className="run-spinner" aria-hidden="true" />
              Running…
            </>
          ) : (
            <>
              {/* Play triangle */}
              <svg
                viewBox="0 0 12 12"
                width="10"
                height="10"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M2.5 1.5 10 6l-7.5 4.5V1.5Z" />
              </svg>
              Run
            </>
          )}
        </button>
      )}

      {/* Inline confirm prompt */}
      {isRunnable && confirming && (
        <span className="run-confirm">
          <span className="run-confirm-label">Run this command?</span>
          <button className="run-confirm-yes" onClick={handleConfirm} type="button">
            Yes
          </button>
          <button className="run-confirm-no" onClick={handleCancel} type="button">
            Cancel
          </button>
        </span>
      )}

      {/* Copy button — always shown */}
      <button
        className={`copy-btn${copied ? " copied" : ""}`}
        onClick={handleCopy}
        type="button"
        title="Copy code"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
