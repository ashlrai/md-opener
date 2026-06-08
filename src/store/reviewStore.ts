/**
 * reviewStore.ts — the human side of the agent review loop.
 *
 * When an agent calls the `request_review` MCP tool, the Rust IPC server emits
 * `mcp://review`; the bridge registers it here and the ReviewPanel appears. The
 * human's Approve / Request-changes / Dismiss verdict is recorded via the
 * `set_review_verdict` command, which the agent's polling MCP tool picks up.
 */

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type ReviewVerdict = "approved" | "changes_requested" | "dismissed";

export interface PendingReview {
  reviewId: string;
  path: string | null;
  content: string | null;
  timeoutMs: number;
  /** Date.now() when the review was registered (for the countdown). */
  registeredAt: number;
}

interface ReviewState {
  pending: PendingReview | null;
  draftComment: string;
  registerReview: (review: PendingReview) => void;
  setDraftComment: (text: string) => void;
  submitVerdict: (verdict: ReviewVerdict) => Promise<void>;
  /**
   * Dismiss the pending review. Pass the `reviewId` it's meant to dismiss (e.g.
   * from an expiring countdown) so a late firing can't dismiss a *newer* review
   * that has since replaced it.
   */
  dismiss: (reviewId?: string) => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  pending: null,
  draftComment: "",

  registerReview: (review) => set({ pending: review, draftComment: "" }),
  setDraftComment: (draftComment) => set({ draftComment }),

  submitVerdict: async (verdict) => {
    const { pending, draftComment } = get();
    if (!pending) return;
    set({ pending: null, draftComment: "" });
    await invoke("set_review_verdict", {
      reviewId: pending.reviewId,
      verdict,
      comments: draftComment.trim() || null,
    }).catch(() => {
      // Verdict couldn't be recorded (app/IPC issue) — the agent will time out.
    });
  },

  dismiss: (reviewId?: string) => {
    const { pending } = get();
    if (!pending) return;
    // Only act if the caller's target is still the pending review — guards a
    // stale countdown from dismissing a review the human hasn't seen yet.
    if (reviewId && reviewId !== pending.reviewId) return;
    // Record a "dismissed" verdict so the agent's poll exits promptly.
    void invoke("set_review_verdict", {
      reviewId: pending.reviewId,
      verdict: "dismissed",
      comments: null,
    }).catch(() => {});
    set({ pending: null, draftComment: "" });
  },
}));
