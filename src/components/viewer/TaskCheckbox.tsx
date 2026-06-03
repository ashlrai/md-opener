/**
 * TaskCheckbox.tsx
 *
 * Interactive checkbox for GFM task-list items rendered inside the Renderer.
 *
 * react-markdown renders `- [ ] …` items as:
 *   <li class="task-list-item">
 *     <input type="checkbox" disabled />
 *     …
 *   </li>
 *
 * The Renderer overrides the `input` component with this component. It:
 *   1. Reads the source line number from `node.position.start.line`.
 *   2. On toggle, calls `toggleTaskAtLine` on the store's `content`.
 *   3. Calls `setContent` + `save()` to persist immediately.
 *
 * If the document has no path (unsaved), the toggle still updates in-memory
 * content so the view stays consistent; `save()` is a no-op in that case.
 */

import type { Element } from "hast";
import { type ChangeEvent, useCallback } from "react";
import { toggleTaskAtLine } from "../../lib/tasklist";
import { useDocumentStore } from "../../store/documentStore";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TaskCheckboxProps {
  /** Passed by react-markdown — the underlying hast element node. */
  node?: Element;
  checked?: boolean;
  /** react-markdown always renders task checkboxes as disabled — we override. */
  disabled?: boolean;
  /** Remaining props forwarded from react-markdown's component override. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskCheckbox({ node, checked, ...rest }: TaskCheckboxProps) {
  const content = useDocumentStore((s) => s.content);
  const setContent = useDocumentStore((s) => s.setContent);
  const save = useDocumentStore((s) => s.save);

  // node.position.start.line is 1-based in unist. For task checkboxes,
  // react-markdown attaches the position of the <li> element. The checkbox
  // input is on the same line as the list marker.
  const sourceLine = node?.position?.start?.line ?? 0;

  const handleChange = useCallback(
    (_e: ChangeEvent<HTMLInputElement>) => {
      if (!sourceLine) return;
      const updated = toggleTaskAtLine(content, sourceLine);
      if (updated === content) return; // no-op guard
      setContent(updated);
      // Fire-and-forget — errors surface via documentStore.error.
      save().catch(() => {});
    },
    [content, sourceLine, setContent, save],
  );

  // Strip the `node` and `disabled` props to avoid leaking onto the DOM input.
  // We intentionally remove `disabled` so the checkbox is interactive.
  const {
    disabled: _disabled,
    node: _node,
    ...domProps
  } = {
    disabled: rest.disabled,
    node: rest.node,
    ...rest,
  };

  return (
    <input
      {...domProps}
      type="checkbox"
      checked={checked ?? false}
      onChange={handleChange}
      className="task-checkbox"
      // aria label derives from checked state for screen readers
      aria-label={checked ? "Mark as not done" : "Mark as done"}
    />
  );
}
