/**
 * YAML frontmatter helpers.
 *
 * Milkdown/Crepe does not support frontmatter (it would render the `---` block
 * as a paragraph), so before handing content to the WYSIWYG editor we split the
 * frontmatter off, edit only the body, and re-attach the frontmatter on save.
 * The raw source editor, by contrast, edits the full content losslessly.
 */

const FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/;

export interface SplitDocument {
  /** The frontmatter block including its closing fence and trailing newline, or "". */
  frontmatter: string;
  /** Everything after the frontmatter. */
  body: string;
}

export function splitFrontmatter(raw: string): SplitDocument {
  const match = raw.match(FRONTMATTER_RE);
  if (match) {
    return { frontmatter: match[1], body: match[2] };
  }
  return { frontmatter: "", body: raw };
}

/** Re-attach frontmatter to an edited body. */
export function joinFrontmatter(frontmatter: string, body: string): string {
  return frontmatter ? frontmatter + body : body;
}
