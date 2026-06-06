/**
 * activationStore.ts — local-only activation instrumentation + gating.
 *
 * Tracks the early events that predict retention so the first-run UX can guide
 * (gently) toward the activation moment, and so one-time nudges (the
 * "watch this folder" prompt, first-session auto-outline) fire exactly once.
 *
 * The primary activation event is WATCHING A FOLDER — the moment Ashlr becomes
 * "where my agent's markdown lands". Everything here is on-device; no telemetry.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ActivationState {
  firstRunAt: number | null;
  /** Set when the user first watches a folder (the activation moment). */
  activatedAt: number | null;
  watchStartedAt: number | null;
  setDefaultAt: number | null;
  firstAIUseAt: number | null;
  firstEditSaveAt: number | null;
  filesOpenedCount: number;
  /** Epoch ms of the previous launch — drives the "while you were away" digest. */
  lastSeenAt: number | null;
  /** The inline "watch this folder" nudge was dismissed. */
  agentPromptDismissed: boolean;
  /** First-session one-time affordances (e.g. auto-outline) have run. */
  firstSessionOnboarded: boolean;

  markFirstRun: () => void;
  markActivated: () => void;
  markEvent: (name: "setDefault" | "firstAIUse" | "firstEditSave") => void;
  bumpFilesOpened: () => void;
  /** Record this launch; returns the PREVIOUS lastSeenAt (for the away-digest). */
  touchLastSeen: () => number | null;
  dismissAgentPrompt: () => void;
  markFirstSessionOnboarded: () => void;
}

export const useActivationStore = create<ActivationState>()(
  persist(
    (set, get) => ({
      firstRunAt: null,
      activatedAt: null,
      watchStartedAt: null,
      setDefaultAt: null,
      firstAIUseAt: null,
      firstEditSaveAt: null,
      filesOpenedCount: 0,
      lastSeenAt: null,
      agentPromptDismissed: false,
      firstSessionOnboarded: false,

      markFirstRun: () => {
        if (get().firstRunAt == null) set({ firstRunAt: Date.now() });
      },
      markActivated: () =>
        set((s) => ({
          activatedAt: s.activatedAt ?? Date.now(),
          watchStartedAt: s.watchStartedAt ?? Date.now(),
        })),
      markEvent: (name) =>
        set((s) => {
          const key = `${name}At` as
            | "setDefaultAt"
            | "firstAIUseAt"
            | "firstEditSaveAt";
          return s[key] == null ? { [key]: Date.now() } : {};
        }),
      bumpFilesOpened: () => set((s) => ({ filesOpenedCount: s.filesOpenedCount + 1 })),
      touchLastSeen: () => {
        const prev = get().lastSeenAt;
        set({ lastSeenAt: Date.now() });
        return prev;
      },
      dismissAgentPrompt: () => set({ agentPromptDismissed: true }),
      markFirstSessionOnboarded: () => set({ firstSessionOnboarded: true }),
    }),
    { name: "mdopener-activation" },
  ),
);
