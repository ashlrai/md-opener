/**
 * tasklist.ts
 *
 * Pure helpers for interactive GFM task-list write-back.
 * These functions are fully unit-testable (no DOM, no React, no Tauri).
 *
 * GFM task-list source format:
 *   - [ ] unchecked item
 *   - [x] checked item      (GFM accepts both lowercase and uppercase X)
 *
 * react-markdown reports `node.position.start.line` as 1-based.
 */

// Matches the checkbox marker at the very start of a list-item content line.
// Handles `- [ ]`, `* [ ]`, `1. [ ]` (any list marker) with optional indent.
const TASK_CHECKBOX_RE = /^(\s*(?:[-*+]|\d+\.)\s+)\[( |x|X)\](\s)/;

/**
 * Toggle the checkbox on `line` (1-based) in `content`.
 *
 * Returns the updated full content string, or the original string if the line
 * doesn't contain a recognisable checkbox (safe no-op).
 *
 * @param content  Full markdown document string.
 * @param line     1-based line number (from `node.position.start.line`).
 */
export function toggleTaskAtLine(content: string, line: number): string {
  if (line < 1) return content;

  const lines = content.split("\n");
  const idx = line - 1; // convert to 0-based

  if (idx >= lines.length) return content;

  const original = lines[idx];
  const match = TASK_CHECKBOX_RE.exec(original);

  if (!match) return content; // not a task-list checkbox line

  const prefix = match[1]; // e.g. "- "
  const marker = match[2]; // " " or "x" or "X"
  const suffix = match[3]; // space after bracket

  const toggled = marker === " " ? "x" : " ";
  lines[idx] =
    `${prefix}[${toggled}]${suffix}${original.slice(prefix.length + 3 + suffix.length)}`;

  return lines.join("\n");
}

/**
 * Return whether a line (1-based) looks like a GFM task checkbox.
 * Useful for quick validation before calling toggleTaskAtLine.
 */
export function isTaskLine(content: string, line: number): boolean {
  if (line < 1) return false;
  const lines = content.split("\n");
  const idx = line - 1;
  if (idx >= lines.length) return false;
  return TASK_CHECKBOX_RE.test(lines[idx]);
}
