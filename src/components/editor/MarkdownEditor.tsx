import { Crepe } from "@milkdown/crepe";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { useRef } from "react";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { joinFrontmatter, splitFrontmatter } from "../../lib/frontmatter";
import { useDocumentStore } from "../../store/documentStore";
import "../../styles/editor.css";

/**
 * WYSIWYG Markdown editor (Milkdown Crepe). Frontmatter is split off before
 * editing and re-attached on every change, since Crepe doesn't model it.
 * Mounted fresh per document (keyed by path + reloadNonce in Shell), so the
 * mount-once `useEditor([])` always starts from the latest content.
 */
function CrepeInner({ initialContent }: { initialContent: string }) {
  const fmRef = useRef("");
  const lastBodyRef = useRef("");
  const setContent = useDocumentStore((s) => s.setContent);
  const setContentRef = useRef(setContent);
  setContentRef.current = setContent;

  useEditor((root) => {
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

  return <Milkdown />;
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
