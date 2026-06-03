// AI assistant Zustand store.
// Persists apiKey and provider preferences to localStorage (zustand/persist).
// TODO: migrate apiKey storage to macOS Keychain via a Tauri plugin once
//       tauri-plugin-stronghold or similar is available, to avoid storing
//       secrets in plaintext localStorage.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AICapabilities } from "../ai/types";

// ---------------------------------------------------------------------------
// Chat message type (extends AIMessage with UI metadata)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** ISO timestamp for display */
  timestamp: number;
  /** true while the assistant is still streaming this message */
  streaming?: boolean;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface AIState {
  /** Whether the AI sidebar is open */
  open: boolean;
  /** The resolved provider capabilities, null if not yet detected */
  provider: AICapabilities | null;
  /** The provider id string (e.g. "ollama", "anthropic", "noop") */
  providerId: string | null;
  /** Full chat transcript for the current session */
  messages: ChatMessage[];
  /** true while a generation is in flight */
  busy: boolean;
  /** Anthropic (or future provider) API key — persisted to localStorage.
   *  TODO: move to Keychain (see note above). */
  apiKey: string | null;
  /** Persisted user preference for which tier to use when multiple available */
  preferredTier: 0 | 1 | 2 | 3 | null;

  // Actions
  toggle(): void;
  open_(): void;
  close(): void;
  setProvider(id: string, caps: AICapabilities): void;
  clearProvider(): void;
  pushMessage(msg: Omit<ChatMessage, "id" | "timestamp">): ChatMessage;
  updateLastAssistantMessage(delta: string): void;
  finalizeLastAssistantMessage(): void;
  clearMessages(): void;
  setBusy(busy: boolean): void;
  setApiKey(key: string | null): void;
  setPreferredTier(tier: 0 | 1 | 2 | 3 | null): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useAIStore = create<AIState>()(
  persist(
    (set) => ({
      open: false,
      provider: null,
      providerId: null,
      messages: [],
      busy: false,
      apiKey: null,
      preferredTier: null,

      toggle() {
        set((s) => ({ open: !s.open }));
      },

      open_() {
        set({ open: true });
      },

      close() {
        set({ open: false });
      },

      setProvider(id, caps) {
        set({ providerId: id, provider: caps });
      },

      clearProvider() {
        set({ providerId: null, provider: null });
      },

      pushMessage(partial) {
        const msg: ChatMessage = {
          id: makeId(),
          timestamp: Date.now(),
          ...partial,
        };
        set((s) => ({ messages: [...s.messages, msg] }));
        return msg;
      },

      /** Append a streaming delta to the last assistant message in place. */
      updateLastAssistantMessage(delta) {
        set((s) => {
          const msgs = [...s.messages];
          // Find last assistant message that is still streaming.
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === "assistant" && msgs[i].streaming) {
              msgs[i] = { ...msgs[i], content: msgs[i].content + delta };
              return { messages: msgs };
            }
          }
          // No streaming message found — create one (shouldn't normally happen).
          msgs.push({
            id: makeId(),
            role: "assistant",
            content: delta,
            timestamp: Date.now(),
            streaming: true,
          });
          return { messages: msgs };
        });
      },

      /** Mark the last streaming assistant message as complete. */
      finalizeLastAssistantMessage() {
        set((s) => {
          const msgs = [...s.messages];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === "assistant" && msgs[i].streaming) {
              msgs[i] = { ...msgs[i], streaming: false };
              return { messages: msgs };
            }
          }
          return {};
        });
      },

      clearMessages() {
        set({ messages: [] });
      },

      setBusy(busy) {
        set({ busy });
      },

      setApiKey(key) {
        set({ apiKey: key });
      },

      setPreferredTier(tier) {
        set({ preferredTier: tier });
      },
    }),
    {
      name: "mdopener-ai",
      // Only persist user preferences and credentials — never chat history.
      partialize: (s) => ({
        apiKey: s.apiKey,
        preferredTier: s.preferredTier,
      }),
    },
  ),
);
