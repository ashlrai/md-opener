/**
 * Callout.tsx
 *
 * Renders styled callout cards for the five GitHub-style callout types:
 *   note | tip | warning | important | caution
 *
 * The remark-callouts plugin transforms `> [!NOTE] …` blockquotes into:
 *   <div class="callout callout-note" data-callout="note">…</div>
 *
 * Renderer.tsx maps the `div` component override to this component when the
 * element carries the `callout` className. The body children are passed through
 * as React children so react-markdown's normal rendering pipeline handles them.
 *
 * Design: colored left border + tinted background + SVG icon + bold title.
 * All colors are derived from CSS custom properties — works in all themes.
 */

import type { Element } from "hast";
import type { ReactNode } from "react";
import type { CalloutType } from "../../lib/remark-callouts";

// ---------------------------------------------------------------------------
// Icon SVGs (inline, theme-color-aware via currentColor)
// ---------------------------------------------------------------------------

const ICONS: Record<CalloutType, ReactNode> = {
  note: (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm6.5-.25A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
    </svg>
  ),
  tip: (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.537 1.495v.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-.25c0-.192-.083-.47-.274-.749a9.388 9.388 0 0 0-.589-.748c-.542-.64-1.301-1.537-1.301-2.853C2.5 2.24 5.072 0 8 0s5.5 2.24 5.5 5.25c0 1.316-.759 2.213-1.3 2.853-.218.256-.44.519-.59.748-.19.279-.273.557-.273.749v.25h1.75a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75v-.5c0-.599.253-1.084.537-1.495.203-.292.45-.584.673-.848.559-.679.983-1.32.983-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z" />
    </svg>
  ),
  warning: (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
    </svg>
  ),
  important: (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
    </svg>
  ),
  caution: (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
    </svg>
  ),
};

const TITLES: Record<CalloutType, string> = {
  note: "Note",
  tip: "Tip",
  warning: "Warning",
  important: "Important",
  caution: "Caution",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalloutProps {
  /** The callout type, read from `data-callout` attribute. */
  calloutType: CalloutType;
  /** Rendered body content from react-markdown. */
  children?: ReactNode;
  /** Forwarded hast node (unused, stripped from DOM). */
  node?: Element;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Callout({ calloutType, children, node: _node }: CalloutProps) {
  const icon = ICONS[calloutType] ?? ICONS.note;
  const title = TITLES[calloutType] ?? "Note";

  return (
    <div
      className={`callout callout-${calloutType}`}
      data-callout={calloutType}
      role="note"
    >
      <div className="callout-header">
        <span className="callout-icon">{icon}</span>
        <span className="callout-title">{title}</span>
      </div>
      <div className="callout-body">{children}</div>
    </div>
  );
}
