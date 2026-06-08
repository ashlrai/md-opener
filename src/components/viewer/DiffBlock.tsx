/**
 * DiffBlock.tsx — renders a ```diff fenced block with per-hunk Apply/Copy actions.
 *
 * For each parsed hunk:
 *   - Renders Shiki-highlighted diff lines (reuses highlightCode from shiki.ts).
 *   - Shows a DiffHunkActions strip: Copy (hunk text) + Apply (confirm → patch).
 *
 * Apply flow:
 *   1. If hunk.targetFile canonical-matches the open doc (or targetFile is null)
 *      → patch in-memory via documentStore.setContent + save.
 *   2. Otherwise → invoke("apply_file_patch", { path, find, replace }) to patch
 *      a different file on disk.
 *
 * Falls back to a plain <CodeBlock lang="diff"> when parse yields 0 hunks.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ParsedHunk, parseDiffHunks } from "../../lib/diff";
import { highlightCode } from "../../lib/shiki";
import { useDocumentStore } from "../../store/documentStore";
import { toast } from "../../store/toastStore";
import { CodeBlock } from "./CodeBlock";

// ---------------------------------------------------------------------------
// DiffHunkActions — Copy + Apply strip
// ---------------------------------------------------------------------------

interface DiffHunkActionsProps {
  hunk: ParsedHunk;
  applied: boolean;
  onApplied: () => void;
}

function DiffHunkActions({ hunk, applied, onApplied }: DiffHunkActionsProps) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);

  // ── Copy ──────────────────────────────────────────────────────────────────

  const handleCopy = useCallback(async () => {
    const text = [hunk.header, hunk.find].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }, [hunk]);

  // ── Apply — confirm phase ────────────────────────────────────────────────

  const handleApplyClick = useCallback(() => {
    setConfirming(true);
  }, []);

  const handleCancel = useCallback(() => {
    setConfirming(false);
  }, []);

  const handleConfirm = useCallback(async () => {
    setConfirming(false);
    setApplying(true);
    try {
      const store = useDocumentStore.getState();
      const openPath = store.path;

      // Decide whether this hunk targets the open document or another file.
      const targetsOpenDoc = (() => {
        if (!hunk.targetFile) return true; // no header → treat as open doc
        if (!openPath) return false;
        // Canonical path comparison: strip leading slashes, compare tail.
        const norm = (p: string) => p.replace(/\\/g, "/").replace(/^[ab]\//, "");
        return norm(openPath).endsWith(norm(hunk.targetFile));
      })();

      if (targetsOpenDoc) {
        // Patch the in-memory document.
        const content = store.content;
        const count = content.split(hunk.find).length - 1;
        if (count === 0) {
          toast.error("Patch not found — the document may have already changed.");
          return;
        }
        if (count > 1) {
          toast.error("Patch anchor is ambiguous — include more context lines.");
          return;
        }
        const newContent = content.replace(hunk.find, hunk.replace);
        store.setContent(newContent);
        await store.save();
        toast.success("Hunk applied");
        onApplied();
      } else {
        // Patch an external file via Tauri command.
        await invoke("apply_file_patch", {
          path: hunk.targetFile,
          find: hunk.find,
          replace: hunk.replace,
        });
        toast.success(`Hunk applied to ${hunk.targetFile}`);
        onApplied();
      }
    } catch (e) {
      toast.error(`Apply failed: ${String(e)}`);
    } finally {
      setApplying(false);
    }
  }, [hunk, onApplied]);

  if (applied) return null;

  return (
    <div className="diff-hunk-actions">
      {/* Copy button */}
      {!confirming && (
        <button
          className={`diff-copy-btn${copied ? " copied" : ""}`}
          type="button"
          onClick={handleCopy}
          title="Copy hunk"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}

      {/* Apply button / confirm prompt */}
      {!confirming ? (
        <button
          className={`diff-apply-btn${applying ? " applying" : ""}`}
          type="button"
          onClick={handleApplyClick}
          disabled={applying}
          title="Apply this hunk to the target file"
        >
          {applying ? "Applying…" : "Apply"}
        </button>
      ) : (
        <span className="diff-confirm">
          <span className="diff-confirm-label">Apply this hunk?</span>
          <button className="diff-confirm-yes" type="button" onClick={handleConfirm}>
            Yes
          </button>
          <button className="diff-confirm-no" type="button" onClick={handleCancel}>
            Cancel
          </button>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SingleHunk — highlighted Shiki output + action strip for one hunk
// ---------------------------------------------------------------------------

interface SingleHunkProps {
  hunk: ParsedHunk;
  onApplied: () => void;
  applied: boolean;
}

function SingleHunk({ hunk, onApplied, applied }: SingleHunkProps) {
  const [html, setHtml] = useState<string | null>(null);
  const isMounted = useRef(true);

  // Build the hunk body text for Shiki — include the @@ header so Shiki can
  // correctly parse add/remove line markers.
  const hunkText = [hunk.header, ...buildHunkLines(hunk)].join("\n");

  useEffect(() => {
    isMounted.current = true;
    highlightCode(hunkText, "diff")
      .then((result) => {
        if (isMounted.current) setHtml(result);
      })
      .catch(() => {
        if (isMounted.current) setHtml(null);
      });
    return () => {
      isMounted.current = false;
    };
  }, [hunkText]);

  return (
    <div className={`diff-hunk${applied ? " diff-hunk--applied" : ""}`}>
      <div className="diff-hunk-header">
        <span className="diff-hunk-header-text">{hunk.header}</span>
        <DiffHunkActions hunk={hunk} applied={applied} onApplied={onApplied} />
      </div>
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="code-plain">
          <code>{hunkText}</code>
        </pre>
      )}
    </div>
  );
}

/**
 * Reconstruct the unified-diff lines for a hunk from its find/replace strings.
 * Context lines (present in both) get a space prefix; removed lines get `-`;
 * added lines get `+`.
 */
function buildHunkLines(hunk: ParsedHunk): string[] {
  const findLines = hunk.find.split("\n");
  const replaceLines = hunk.replace.split("\n");

  // Compute longest common prefix (context before) and suffix (context after).
  let prefixLen = 0;
  while (
    prefixLen < findLines.length &&
    prefixLen < replaceLines.length &&
    findLines[prefixLen] === replaceLines[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < findLines.length - prefixLen &&
    suffixLen < replaceLines.length - prefixLen &&
    findLines[findLines.length - 1 - suffixLen] ===
      replaceLines[replaceLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const lines: string[] = [];
  for (let i = 0; i < prefixLen; i++) lines.push(` ${findLines[i]}`);
  for (let i = prefixLen; i < findLines.length - suffixLen; i++)
    lines.push(`-${findLines[i]}`);
  for (let i = prefixLen; i < replaceLines.length - suffixLen; i++)
    lines.push(`+${replaceLines[i]}`);
  for (let i = findLines.length - suffixLen; i < findLines.length; i++)
    lines.push(` ${findLines[i]}`);
  return lines;
}

// ---------------------------------------------------------------------------
// DiffBlock — public component
// ---------------------------------------------------------------------------

interface DiffBlockProps {
  code: string;
}

export function DiffBlock({ code }: DiffBlockProps) {
  const hunks = parseDiffHunks(code);
  const [appliedSet, setAppliedSet] = useState<Set<number>>(new Set());

  if (hunks.length === 0) {
    // Fall back to a plain highlighted code block.
    return <CodeBlock code={code} lang="diff" />;
  }

  function markApplied(idx: number) {
    setAppliedSet((prev) => new Set([...prev, idx]));
  }

  return (
    <div className="code-block" data-lang="diff">
      {hunks.map((hunk, idx) => (
        <SingleHunk
          // biome-ignore lint/suspicious/noArrayIndexKey: hunks are stable within a render
          key={idx}
          hunk={hunk}
          applied={appliedSet.has(idx)}
          onApplied={() => markApplied(idx)}
        />
      ))}
    </div>
  );
}
