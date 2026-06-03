import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView as ProseView } from "@milkdown/kit/prose/view";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { useCallback, useEffect, useRef, useState } from "react";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import type { ActionId } from "../../ai/actions";
import { NoProviderError, runInlineTransform } from "../../ai/inline";
import { joinFrontmatter, splitFrontmatter } from "../../lib/frontmatter";
import { useDocumentStore } from "../../store/documentStore";
import "../../styles/editor.css";

/**
 * WYSIWYG Markdown editor (Milkdown Crepe). Frontmatter is split off before
 * editing and re-attached on every change, since Crepe doesn't model it.
 * Mounted fresh per document (keyed by path + reloadNonce in Shell), so the
 * mount-once `useEditor([])` always starts from the latest content.
 *
 * Inline AI: with a non-empty selection, a floating "✨ Rewrite" affordance
 * appears above the selection, and `mod+I` runs Rewrite directly. The selected
 * range is replaced in place with streamed AI output (as plain text, which is
 * the robust path through ProseMirror). Esc cancels; on error the original
 * text is restored and a small inline message is shown.
 */

const INLINE_ACTIONS: { id: ActionId; label: string; icon: string }[] = [
  { id: "rewrite", label: "Rewrite", icon: "✨" },
  { id: "fix-grammar", label: "Fix grammar", icon: "✓" },
  { id: "concise", label: "Make concise", icon: "✂️" },
  { id: "expand", label: "Expand", icon: "➕" },
];

interface InlineAnchor {
  top: number;
  left: number;
}

type InlinePhase =
  | { kind: "menu" }
  | { kind: "running"; label: string }
  | { kind: "error"; message: string };

function CrepeInner({ initialContent }: { initialContent: string }) {
  const fmRef = useRef("");
  const lastBodyRef = useRef("");
  const setContent = useDocumentStore((s) => s.setContent);
  const setContentRef = useRef(setContent);
  setContentRef.current = setContent;

  // The live ProseMirror view, captured once the editor is created.
  const proseRef = useRef<ProseView | null>(null);

  const [anchor, setAnchor] = useState<InlineAnchor | null>(null);
  const [phase, setPhase] = useState<InlinePhase>({ kind: "menu" });
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  // Position the affordance above the current (non-empty) selection.
  const updateAnchor = useCallback(() => {
    if (runningRef.current) return;
    const view = proseRef.current;
    if (!view) return;
    const { from, to } = view.state.selection;
    if (from === to) {
      setAnchor(null);
      return;
    }
    const start = view.coordsAtPos(from);
    const MENU_H = 34;
    const MARGIN = 6;
    let top = start.top - MENU_H - MARGIN;
    if (top < 8) top = view.coordsAtPos(to).bottom + MARGIN;
    setAnchor({ top, left: Math.max(8, start.left) });
    setPhase({ kind: "menu" });
  }, []);

  const runTransform = useCallback(async (actionId: ActionId, label: string) => {
    const view = proseRef.current;
    if (!view || runningRef.current) return;
    const { from, to } = view.state.selection;
    if (from === to) return;
    const original = view.state.doc.textBetween(from, to, "\n");
    if (!original.trim()) return;

    const controller = new AbortController();
    abortRef.current = controller;
    runningRef.current = true;
    setPhase({ kind: "running", label });

    // We always replace [start, end) with the accumulated output so streaming
    // stays a single coherent region.
    const start = from;
    let end = to;
    let acc = "";

    const applyOutput = (next: string) => {
      acc = next;
      const tr = view.state.tr.insertText(acc, start, end);
      // Keep the new text selected so the caret/anchor track the output.
      view.dispatch(tr);
      end = start + acc.length;
    };

    try {
      let pending = "";
      await runInlineTransform({
        text: original,
        actionId,
        signal: controller.signal,
        onDelta: (delta) => {
          pending += delta;
          applyOutput(pending);
        },
      });
      setAnchor(null);
      setPhase({ kind: "menu" });
    } catch (e) {
      // Restore the original text on any failure or cancel.
      try {
        const tr = view.state.tr.insertText(original, start, start + acc.length);
        view.dispatch(tr);
      } catch {
        // View may be gone.
      }
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (aborted) {
        setAnchor(null);
        setPhase({ kind: "menu" });
      } else if (e instanceof NoProviderError) {
        setPhase({
          kind: "error",
          message: "No AI provider — set one up in the AI sidebar.",
        });
      } else {
        const m = e instanceof Error ? e.message : String(e);
        setPhase({ kind: "error", message: m });
      }
    } finally {
      runningRef.current = false;
      abortRef.current = null;
    }
  }, []);

  const runTransformRef = useRef(runTransform);
  runTransformRef.current = runTransform;
  const updateAnchorRef = useRef(updateAnchor);
  updateAnchorRef.current = updateAnchor;

  const { loading, get } = useEditor((root) => {
    const { frontmatter, body } = splitFrontmatter(initialContent);
    fmRef.current = frontmatter;
    lastBodyRef.current = body;

    const crepe = new Crepe({ root, defaultValue: body });
    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => {
        // Ignore no-op echoes; only propagate real content changes.
        if (markdown === lastBodyRef.current) return;
        lastBodyRef.current = markdown;
        setContentRef.current(joinFrontmatter(fmRef.current, markdown));
      });
    });
    return crepe;
  }, []);

  // Once the editor has finished loading, capture the ProseMirror view so
  // inline AI can read selections and dispatch in-place replacements.
  useEffect(() => {
    if (loading) return;
    const editor = get();
    if (!editor) return;
    try {
      editor.action((ctx) => {
        proseRef.current = ctx.get(editorViewCtx);
      });
    } catch {
      proseRef.current = null;
    }
  }, [loading, get]);

  // Track selection changes (mouse + keyboard) to show/hide the affordance,
  // and bind mod+I / Esc at the document level scoped to focus in this editor.
  useEffect(() => {
    const onSelectionChange = () => {
      const view = proseRef.current;
      // Only react when the ProseMirror view holds focus, so we don't fight
      // the source editor or other surfaces.
      if (!view?.hasFocus()) {
        if (!runningRef.current) setAnchor(null);
        return;
      }
      updateAnchorRef.current();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const view = proseRef.current;
      if (!view?.hasFocus()) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "i" || e.key === "I")) {
        if (view.state.selection.from !== view.state.selection.to) {
          e.preventDefault();
          void runTransformRef.current("rewrite", "Rewriting");
        }
      } else if (e.key === "Escape" && abortRef.current) {
        e.preventDefault();
        abortRef.current.abort();
      }
    };

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown, true);
      abortRef.current?.abort();
    };
  }, []);

  return (
    <>
      <Milkdown />
      {anchor && (
        <div
          className="inline-ai"
          style={{ top: anchor.top, left: anchor.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {phase.kind === "menu" && (
            <div
              className="inline-ai-menu"
              role="toolbar"
              aria-label="AI actions for selection"
            >
              {INLINE_ACTIONS.map((a, i) => (
                <span key={a.id} style={{ display: "contents" }}>
                  {i > 0 && <span className="inline-ai-divider" aria-hidden="true" />}
                  <button
                    type="button"
                    className="inline-ai-btn"
                    title={a.label}
                    onClick={() => void runTransform(a.id, a.label)}
                  >
                    <span aria-hidden="true">{a.icon}</span> {a.label}
                  </button>
                </span>
              ))}
            </div>
          )}
          {phase.kind === "running" && (
            <div className="inline-ai-pill" aria-live="polite">
              <span className="inline-ai-spark" aria-hidden="true">
                ✨
              </span>
              {phase.label}…
              <button
                type="button"
                className="inline-ai-cancel"
                title="Cancel (Esc)"
                onClick={() => abortRef.current?.abort()}
              >
                Esc
              </button>
            </div>
          )}
          {phase.kind === "error" && (
            <div className="inline-ai-error" role="alert">
              {phase.message}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function MarkdownEditor({ initialContent }: { initialContent: string }) {
  return (
    <div className="wysiwyg-editor">
      <MilkdownProvider>
        <CrepeInner initialContent={initialContent} />
      </MilkdownProvider>
    </div>
  );
}
