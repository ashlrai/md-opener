/**
 * toastStore.ts — tiny, dependency-free toast queue.
 *
 * The app previously had no transient success/failure feedback (saving was
 * silent). This store backs the <Toast> stack: callers `push(...)` a toast and
 * it auto-dismisses after `timeout` ms. The concurrent count is capped so a
 * burst of events can't bury the screen — the oldest is evicted when full.
 */

import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** ms until auto-dismiss; 0 disables the timer. */
  timeout: number;
  /** Optional click handler (e.g. "New: plan.md" → open it). */
  onClick?: () => void;
}

/** Input to {@link ToastState.push}; id + sensible defaults are filled in. */
export interface ToastInput {
  kind?: ToastKind;
  message: string;
  timeout?: number;
  onClick?: () => void;
}

interface ToastState {
  toasts: Toast[];
  /** Enqueue a toast; returns its id. Auto-dismisses unless timeout is 0. */
  push: (input: ToastInput) => number;
  /** Remove a toast immediately (✕, click, or timer). */
  dismiss: (id: number) => void;
  /** Clear all toasts. */
  clear: () => void;
}

/** Most toasts on screen at once before the oldest is evicted. */
const MAX_TOASTS = 4;
/** Default auto-dismiss delay. */
const DEFAULT_TIMEOUT = 2500;

let seq = 0;
/** Live auto-dismiss timers, so dismiss() can cancel a pending one. */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (input) => {
    const id = ++seq;
    const toast: Toast = {
      id,
      kind: input.kind ?? "info",
      message: input.message,
      timeout: input.timeout ?? DEFAULT_TIMEOUT,
      onClick: input.onClick,
    };

    set((s) => {
      // Cap the stack: drop the oldest (and its timer) when full.
      let next = [...s.toasts, toast];
      if (next.length > MAX_TOASTS) {
        const evicted = next.slice(0, next.length - MAX_TOASTS);
        for (const e of evicted) {
          const t = timers.get(e.id);
          if (t) {
            clearTimeout(t);
            timers.delete(e.id);
          }
        }
        next = next.slice(next.length - MAX_TOASTS);
      }
      return { toasts: next };
    });

    if (toast.timeout > 0) {
      const handle = setTimeout(() => get().dismiss(id), toast.timeout);
      timers.set(id, handle);
    }
    return id;
  },

  dismiss: (id) => {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },

  clear: () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    set({ toasts: [] });
  },
}));

/**
 * Imperative helper for non-React call sites (stores, lib functions) so they
 * don't need a hook. Mirrors the store API.
 */
export const toast = {
  success: (message: string, opts?: Omit<ToastInput, "kind" | "message">) =>
    useToastStore.getState().push({ ...opts, kind: "success", message }),
  error: (message: string, opts?: Omit<ToastInput, "kind" | "message">) =>
    useToastStore.getState().push({ ...opts, kind: "error", message }),
  info: (message: string, opts?: Omit<ToastInput, "kind" | "message">) =>
    useToastStore.getState().push({ ...opts, kind: "info", message }),
};
