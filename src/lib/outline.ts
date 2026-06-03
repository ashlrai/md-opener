/**
 * outline.ts — extract a heading outline (table of contents) from Markdown.
 *
 * Produces the same heading slugs the rendered document uses so the Outline
 * panel's anchor links line up with the ids rehype-slug writes into the DOM.
 *
 * Slug parity: the read view renders through `rehype-slug` (see
 * src/components/viewer/Renderer.tsx), which slugifies each heading's rendered
 * text via `github-slugger`. We import the *same* library here and feed it the
 * heading's plain text (markdown inline syntax stripped), so a given heading
 * yields a byte-identical slug — including lowercase folding, accented-letter
 * retention, and `-1`/`-2` de-duplication. Confirmed against the renderer's
 * plugin list (`rehypeSlug`, default config) and github-slugger@2.
 */

import GithubSlugger from "github-slugger";

export interface HeadingItem {
  /** ATX heading level, 1–6. */
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  /** Rendered heading text (inline markdown stripped, whitespace collapsed). */
  text: string;
  /** Slug id matching the rendered heading's DOM id (anchor target). */
  slug: string;
  /** 1-based source line number of the heading (within the full document). */
  line: number;
}

/**
 * Strip a leading YAML frontmatter block (`---` … `---`), if present.
 * Returns the body plus the number of lines removed, so reported line numbers
 * stay accurate against the original document.
 */
function stripFrontmatter(markdown: string): { lines: string[]; offset: number } {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return { lines, offset: 0 };
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    // Frontmatter ends on a line that is exactly `---` or `...`.
    if (t === "---" || t === "...") {
      return { lines: lines.slice(i + 1), offset: i + 1 };
    }
  }
  // No closing fence — treat the whole thing as body (don't swallow content).
  return { lines, offset: 0 };
}

/**
 * Reduce inline markdown to its plain rendered text so slugs/labels match the
 * DOM. Mirrors what a reader sees: emphasis/strong/strikethrough markers gone,
 * inline-code backticks gone, links/images reduced to their visible label.
 */
function stripInline(text: string): string {
  let s = text;
  // Images: ![alt](url) -> alt
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Links: [label](url) -> label  and  [label][ref] -> label
  s = s.replace(/\[([^\]]*)\]\((?:[^)]*)\)/g, "$1");
  s = s.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  // Inline code: `code` -> code (handles 1+ backtick fences)
  s = s.replace(/(`+)(.+?)\1/g, "$2");
  // Strong / emphasis / strikethrough markers.
  s = s.replace(/(\*\*\*|___)(.+?)\1/g, "$2");
  s = s.replace(/(\*\*|__)(.+?)\1/g, "$2");
  s = s.replace(/(\*|_)(.+?)\1/g, "$2");
  s = s.replace(/~~(.+?)~~/g, "$1");
  // Trailing closing `#`s on an ATX heading (e.g. `## Title ##`).
  s = s.replace(/\s+#+\s*$/, "");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Parse ATX headings (`#`–`######`) into an ordered outline.
 *
 * - Skips a leading YAML frontmatter block.
 * - Ignores `#` lines inside fenced code blocks (``` or ~~~ fences, matched by
 *   the opening fence's marker + length so a longer fence inside doesn't end it).
 * - Slugs are generated with github-slugger (same as the renderer), so repeated
 *   heading text dedupes to `-1`, `-2`, … exactly as the rendered ids do.
 *
 * Note: only ATX headings are collected. Setext headings (underlined with
 * `===`/`---`) are intentionally out of scope — agent-generated docs use ATX,
 * and `---` is ambiguous with thematic breaks / frontmatter.
 */
export function parseHeadings(markdown: string): HeadingItem[] {
  const { lines, offset } = stripFrontmatter(markdown);
  const slugger = new GithubSlugger();
  const out: HeadingItem[] = [];

  let fence: string | null = null; // active fence marker, e.g. "```" or "~~~~"

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);

    if (fence) {
      // Inside a code block: only a closing fence of the same marker char and
      // at least the same length (with no trailing info string) ends it.
      if (fenceMatch) {
        const marker = fenceMatch[1];
        const rest = line.slice(line.indexOf(marker) + marker.length).trim();
        if (marker[0] === fence[0] && marker.length >= fence.length && rest === "") {
          fence = null;
        }
      }
      continue;
    }

    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }

    const h = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (!h) continue;

    const depth = h[1].length as HeadingItem["depth"];
    const text = stripInline(h[2]);
    if (text === "") continue; // empty heading -> no anchor rendered

    out.push({
      depth,
      text,
      slug: slugger.slug(text),
      line: offset + i + 1, // 1-based, in original-document coordinates
    });
  }

  return out;
}
