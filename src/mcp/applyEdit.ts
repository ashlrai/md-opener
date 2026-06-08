/**
 * Exact, unique find→replace — the frontend half of the MCP `/edit` round-trip.
 *
 * This MIRRORS the Rust `apply_unique_edit` contract (see
 * `src-tauri/src/ipc.rs`) exactly, so the agent-facing behavior is identical
 * regardless of which layer runs it:
 *   - empty `find`      → error
 *   - 0 matches         → "not found" error
 *   - exactly 1 match   → replace the single occurrence
 *   - >1 matches        → "not unique" error (reports the count)
 *
 * WHY this lives on the frontend: the edit must apply against the LIVE document
 * the user is editing, not the 200 ms-debounced server-side mirror. Running it
 * here against `documentStore`'s current content both finds text typed within
 * the last debounce window and derives the new content from that live basis, so
 * applying the result can never clobber the user's just-typed edits.
 */

export interface EditOutcome {
  ok: boolean;
  /** Replacements made: 1 on success, 0 on any failure. */
  replaced: number;
  /** The new full document content (only meaningful when `ok`). */
  content?: string;
  /** Human-readable reason when `ok` is false. */
  error?: string;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    count += 1;
    // Advance past this match (non-overlapping), mirroring Rust's
    // `str::matches`, which also counts non-overlapping matches.
    from = i + needle.length;
  }
  return count;
}

/**
 * Apply a single exact find→replace requiring `find` to appear EXACTLY once.
 * Returns the new content on success, or a human-readable error otherwise.
 * Pure — does not touch any store.
 */
export function applyUniqueEdit(
  content: string,
  find: string,
  replace: string,
): EditOutcome {
  if (find === "") {
    return { ok: false, replaced: 0, error: "`find` must not be empty." };
  }
  const n = countOccurrences(content, find);
  if (n === 0) {
    return {
      ok: false,
      replaced: 0,
      error: "`find` string not found in the current document.",
    };
  }
  if (n > 1) {
    return {
      ok: false,
      replaced: 0,
      error: `\`find\` string is not unique (${n} matches) — include more surrounding context to disambiguate.`,
    };
  }
  // Replace only the first (and only) occurrence.
  const idx = content.indexOf(find);
  const next = content.slice(0, idx) + replace + content.slice(idx + find.length);
  return { ok: true, replaced: 1, content: next };
}
