/**
 * copyRichText.ts — copy the current document to the clipboard as rich text.
 *
 * Goal: pasting into Gmail / Slack / Word / Notion preserves formatting
 * (headings, bold, lists, links, code, tables) while pasting into a plain
 * editor yields the Markdown source.
 *
 * How: write a single `ClipboardItem` carrying BOTH MIME types —
 *   • `text/html`  → the rendered, sanitized document body (rich targets use it)
 *   • `text/plain` → the Markdown source (plain targets use it)
 * Rich-text targets pick the HTML flavour; plain targets pick the text flavour.
 * When `ClipboardItem`/`navigator.clipboard.write` is unavailable we fall back
 * to `writeText(markdown)`.
 *
 * HTML source of truth: the already-rendered `.markdown-body` DOM (same element
 * the HTML/PDF/DOCX exports capture). Its `innerHTML` has already passed through
 * the Renderer's rehype-sanitize pipeline; we re-sanitize with DOMPurify as a
 * defensive second pass and wrap it with a few inline base styles, since many
 * mail/chat clients strip `<style>` blocks and class-based CSS.
 */

import DOMPurify from "dompurify";
import { useDocumentStore } from "../store/documentStore";
import { toast } from "../store/toastStore";
import { buildStandaloneHtml } from "./export";
import { waitForElement } from "./waitForElement";

/**
 * A tiny set of inline styles applied to the wrapping <div>. Kept intentionally
 * minimal: rich-text paste targets honour inline styles far more reliably than
 * `<style>` blocks or CSS classes, but most of them already render semantic HTML
 * (h1–h6, strong, ul/ol, a, code, pre, table) acceptably on their own. We just
 * nudge the typographic defaults so the pasted block reads as prose.
 */
const WRAPPER_STYLE = [
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  "font-size:15px",
  "line-height:1.6",
  "color:#1a1a1a",
].join(";");

/**
 * Wrap already-sanitized body markup in the inline-styled <div> that becomes the
 * `text/html` clipboard payload. Pure string logic — no DOM, no environment
 * dependence — so it is the unit-testable core. Returns an empty string when the
 * body is empty/whitespace (nothing meaningful to copy).
 *
 * Exported for tests.
 */
export function wrapRichTextBody(cleanBodyHtml: string): string {
  const trimmed = cleanBodyHtml.trim();
  if (!trimmed) return "";
  return `<div style="${WRAPPER_STYLE}">${trimmed}</div>`;
}

/**
 * Assemble the `text/html` payload from a rendered body's inner HTML: sanitize
 * defensively with DOMPurify (the input is already rehype-sanitized at render
 * time, so this is belt-and-suspenders), then wrap it via {@link wrapRichTextBody}.
 */
export function buildRichTextHtml(bodyInnerHtml: string): string {
  const clean = DOMPurify.sanitize(bodyInnerHtml, {
    USE_PROFILES: { html: true },
  });
  return wrapRichTextBody(clean);
}

/**
 * Read the rendered document body's inner HTML, preferring the live
 * `.markdown-body` element. Falls back to generating export HTML and pulling the
 * `.reading-surface` body out of it (covers the rare case where the element
 * isn't mounted yet). Returns an empty string when neither source yields markup.
 */
function captureRenderedBodyHtml(): string {
  const el = document.querySelector(".markdown-body");
  if (el) return el.innerHTML;

  // Fallback: reuse the export pipeline, then extract just the rendered body.
  try {
    const standalone = buildStandaloneHtml("document");
    const parsed = new DOMParser().parseFromString(standalone, "text/html");
    const body =
      parsed.querySelector(".markdown-body") ??
      parsed.querySelector(".reading-surface");
    return body?.innerHTML ?? "";
  } catch {
    return "";
  }
}

/**
 * Copy the current document to the clipboard as rich text.
 *
 * - No/empty document → `toast.info` and return.
 * - Ensures the read view is mounted (so `.markdown-body` exists) the same way
 *   the export commands do, then builds the dual-MIME clipboard item.
 * - Falls back to plain-text copy of the Markdown when `ClipboardItem`/`write`
 *   is unavailable, or on any write error.
 */
export async function copyDocumentAsRichText(): Promise<void> {
  const doc = useDocumentStore.getState();
  const markdown = doc.content;

  if (!doc.path || !markdown.trim()) {
    toast.info("Open a document first");
    return;
  }

  // The rendered body only exists in read view; switch + wait if needed.
  if (doc.viewMode !== "read") {
    doc.setViewMode("read");
    await waitForElement(".markdown-body");
  }

  const html = buildRichTextHtml(captureRenderedBodyHtml());

  // Fallback path: no rich-clipboard support (or no HTML to write).
  const canWriteRich =
    typeof ClipboardItem !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.clipboard?.write;

  if (!html || !canWriteRich) {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success("Copied as rich text");
    } catch (e) {
      toast.error("Couldn't copy to the clipboard");
      console.warn("[copyRichText] writeText fallback failed", e);
    }
    return;
  }

  try {
    const item = new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([markdown], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
    toast.success("Copied as rich text");
  } catch (e) {
    // Some environments reject ClipboardItem writes (focus, permissions);
    // degrade to a plain-text copy rather than failing outright.
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success("Copied as rich text");
    } catch (inner) {
      toast.error("Couldn't copy to the clipboard");
      console.warn("[copyRichText] clipboard write failed", e, inner);
    }
  }
}
