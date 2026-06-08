/**
 * useFocusTrap — accessibility helper for modal dialogs/overlays.
 *
 * Given a ref to the overlay container, this hook:
 *   1. Remembers the element that had focus when the overlay opened.
 *   2. Moves focus to the first focusable element inside (or the container
 *      itself if it's programmatically focusable, e.g. `tabIndex={-1}`).
 *   3. Traps Tab / Shift+Tab so focus cycles within the overlay instead of
 *      escaping to the page behind it.
 *   4. Restores focus to the original trigger element on unmount/close.
 *
 * It intentionally does NOT handle Escape-to-close — components own their own
 * close semantics (some stop propagation, some don't), so Esc stays local.
 *
 * Mirrors the focus-management pattern already used in SettingsPanel/
 * ExportDialog/CommandPalette, consolidated so every modal gets full Tab
 * cycling + focus restore without duplicating the logic.
 */

import { type RefObject, useEffect } from "react";

/** CSS selector for elements that can receive keyboard focus. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "textarea:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    // Skip elements hidden from layout (display:none / visibility:hidden give
    // a zero-size client rect).
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
  );
}

export interface FocusTrapOptions {
  /**
   * When false, the trap is inactive (no focus move, no restore). Lets callers
   * mount the hook unconditionally but gate it on an `open` flag. Defaults true.
   */
  active?: boolean;
  /**
   * When true, focus the container element itself on activation rather than its
   * first focusable child. Useful for panels that are themselves `tabIndex={-1}`
   * and present their content via an accessible name. Defaults false.
   */
  focusContainer?: boolean;
}

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  { active = true, focusContainer = false }: FocusTrapOptions = {},
): void {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    // Remember what to restore focus to when we close.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus inside the overlay.
    if (focusContainer) {
      container.focus();
    } else {
      const focusables = getFocusable(container);
      (focusables[0] ?? container).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !container) return;
      const focusables = getFocusable(container);
      if (focusables.length === 0) {
        // Nothing focusable inside — keep focus pinned to the container.
        e.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement;

      if (e.shiftKey) {
        // Shift+Tab on the first (or outside) → wrap to last.
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab on the last (or outside) → wrap to first.
        if (activeEl === last || !container.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger if it's still in the document and focusable.
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus?.();
      }
    };
  }, [ref, active, focusContainer]);
}
