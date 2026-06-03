import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { useSettingsStore } from "../../store/settingsStore";
import "../../styles/editor.css";

/**
 * Raw Markdown source editor (CodeMirror 6). Edits the FULL document content
 * losslessly — the escape hatch for footnotes, raw HTML, and anything the
 * WYSIWYG editor would normalize away.
 */
export function SourceEditor({ initialContent }: { initialContent: string }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const initialRef = useRef(initialContent);
  const theme = useSettingsStore((s) => s.theme);

  const setContent = useDocumentStore((s) => s.setContent);
  const setContentRef = useRef(setContent);
  setContentRef.current = setContent;

  // Create the editor once (per mount; Shell keys mounts by path + nonce).
  useEffect(() => {
    if (!parentRef.current) return;
    const view = new EditorView({
      parent: parentRef.current,
      state: EditorState.create({
        doc: initialRef.current,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) setContentRef.current(u.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": {
              fontFamily: "var(--mono-font)",
              fontSize: "13.5px",
              lineHeight: "1.65",
            },
            ".cm-content": { padding: "16px 0" },
            "&.cm-focused": { outline: "none" },
          }),
          themeCompartment.current.of([]),
        ],
      }),
    });
    viewRef.current = view;
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Swap the syntax theme without rebuilding the editor (keeps cursor/history).
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(
        theme === "midnight" ? oneDark : [],
      ),
    });
  }, [theme]);

  return <div className="source-editor" ref={parentRef} />;
}
