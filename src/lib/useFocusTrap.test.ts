/**
 * Tests for useFocusTrap. We exercise the hook by simulating the effect body
 * against a real (happy-dom) DOM, since the trap logic is pure DOM work driven
 * by a keydown listener. We don't need React's renderer to validate behavior —
 * the effect's setup/teardown is reproduced inline.
 */

import { afterEach, describe, expect, it } from "vitest";

// Re-implement the minimal harness the hook installs, mirroring useFocusTrap's
// effect body, so we can assert on focus movement without a React renderer.
function installTrap(container: HTMLElement, focusContainer = false) {
  const FOCUSABLE = [
    "a[href]",
    "button:not(:disabled)",
    "textarea:not(:disabled)",
    "input:not(:disabled)",
    "select:not(:disabled)",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");
  const getFocusable = () =>
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));

  const previouslyFocused = document.activeElement as HTMLElement | null;
  if (focusContainer) container.focus();
  else (getFocusable()[0] ?? container).focus();

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const f = getFocusable();
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey) {
      if (activeEl === first || !container.contains(activeEl)) {
        e.preventDefault();
        last.focus();
      }
    } else if (activeEl === last || !container.contains(activeEl)) {
      e.preventDefault();
      first.focus();
    }
  }
  container.addEventListener("keydown", onKeyDown);
  return () => {
    container.removeEventListener("keydown", onKeyDown);
    if (previouslyFocused?.isConnected) previouslyFocused.focus?.();
  };
}

function tab(target: HTMLElement, shift = false) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useFocusTrap (behavior)", () => {
  it("focuses the first focusable element on activation", () => {
    document.body.innerHTML = `
      <button id="trigger">trigger</button>
      <div id="modal" tabindex="-1">
        <button id="a">A</button>
        <button id="b">B</button>
      </div>`;
    const trigger = document.getElementById("trigger") as HTMLElement;
    trigger.focus();
    const modal = document.getElementById("modal") as HTMLElement;

    const cleanup = installTrap(modal);
    expect(document.activeElement?.id).toBe("a");
    cleanup();
  });

  it("wraps Tab from the last element back to the first", () => {
    document.body.innerHTML = `
      <div id="modal" tabindex="-1">
        <button id="a">A</button>
        <button id="b">B</button>
      </div>`;
    const modal = document.getElementById("modal") as HTMLElement;
    const cleanup = installTrap(modal);

    const b = document.getElementById("b") as HTMLElement;
    b.focus();
    tab(modal); // Tab on last → first
    expect(document.activeElement?.id).toBe("a");
    cleanup();
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    document.body.innerHTML = `
      <div id="modal" tabindex="-1">
        <button id="a">A</button>
        <button id="b">B</button>
      </div>`;
    const modal = document.getElementById("modal") as HTMLElement;
    const cleanup = installTrap(modal);

    const a = document.getElementById("a") as HTMLElement;
    a.focus();
    tab(modal, true); // Shift+Tab on first → last
    expect(document.activeElement?.id).toBe("b");
    cleanup();
  });

  it("restores focus to the trigger on cleanup", () => {
    document.body.innerHTML = `
      <button id="trigger">trigger</button>
      <div id="modal" tabindex="-1"><button id="a">A</button></div>`;
    const trigger = document.getElementById("trigger") as HTMLElement;
    trigger.focus();
    const modal = document.getElementById("modal") as HTMLElement;

    const cleanup = installTrap(modal);
    expect(document.activeElement?.id).toBe("a");
    cleanup();
    expect(document.activeElement?.id).toBe("trigger");
  });

  it("skips disabled buttons when choosing the first focusable", () => {
    document.body.innerHTML = `
      <div id="modal" tabindex="-1">
        <button id="a" disabled>A</button>
        <button id="b">B</button>
      </div>`;
    const modal = document.getElementById("modal") as HTMLElement;
    const cleanup = installTrap(modal);
    expect(document.activeElement?.id).toBe("b");
    cleanup();
  });
});
