// Selection action presets — maps a named action to a system prompt + user
// message template.  Used by SelectionPopover and AISidebar quick buttons.

import type { AIMessage } from "./types";

// ---------------------------------------------------------------------------
// Action definitions
// ---------------------------------------------------------------------------

export type ActionId = "explain" | "summarize" | "rewrite" | "translate" | "tldr";

export interface AIAction {
  id: ActionId;
  label: string;
  /** Short label for toolbar buttons */
  shortLabel: string;
  /** Emoji/icon hint for display */
  icon: string;
  /** Build the messages array from selected text (and optional extra args) */
  buildMessages(text: string, arg?: string): AIMessage[];
}

// ---------------------------------------------------------------------------
// Helper to build a minimal two-message conversation
// ---------------------------------------------------------------------------

function msg(system: string, user: string): AIMessage[] {
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ---------------------------------------------------------------------------
// The action catalogue
// ---------------------------------------------------------------------------

export const AI_ACTIONS: AIAction[] = [
  {
    id: "explain",
    label: "Explain",
    shortLabel: "Explain",
    icon: "💡",
    buildMessages(text) {
      return msg(
        "You are a clear, concise technical explainer. " +
          "Explain the provided text in plain language. " +
          "Be thorough but avoid padding. Use markdown where helpful.",
        `Explain the following:\n\n${text}`,
      );
    },
  },

  {
    id: "summarize",
    label: "Summarize",
    shortLabel: "Summarize",
    icon: "📝",
    buildMessages(text) {
      return msg(
        "You are an expert at summarizing text. " +
          "Produce a concise bullet-point summary capturing the key points. " +
          "Use markdown bullet points.",
        `Summarize the following:\n\n${text}`,
      );
    },
  },

  {
    id: "rewrite",
    label: "Rewrite (clearer)",
    shortLabel: "Rewrite",
    icon: "✏️",
    buildMessages(text) {
      return msg(
        "You are an expert editor. Rewrite the provided text to be clearer " +
          "and more concise while preserving the original meaning and voice. " +
          "Output only the rewritten text — no commentary, no preamble.",
        `Rewrite the following text to be clearer and more concise:\n\n${text}`,
      );
    },
  },

  {
    id: "translate",
    label: "Translate",
    shortLabel: "Translate",
    icon: "🌐",
    buildMessages(text, arg = "Spanish") {
      return msg(
        `You are a professional translator. Translate the provided text into ${arg}. ` +
          "Output only the translation — no commentary, no preamble.",
        `Translate the following into ${arg}:\n\n${text}`,
      );
    },
  },

  {
    id: "tldr",
    label: "TL;DR",
    shortLabel: "TL;DR",
    icon: "⚡",
    buildMessages(text) {
      return msg(
        "You are an expert at distilling information. " +
          "Produce a single punchy TL;DR sentence (max 2 sentences) that " +
          "captures the essential point of the text.",
        `Write a TL;DR for the following:\n\n${text}`,
      );
    },
  },
];

/** Look up an action by id (throws if not found — should never happen). */
export function getAction(id: ActionId): AIAction {
  const action = AI_ACTIONS.find((a) => a.id === id);
  if (!action) throw new Error(`Unknown AI action: ${id}`);
  return action;
}

// ---------------------------------------------------------------------------
// Document-level action presets (for the AISidebar quick buttons)
// These accept the full document content instead of a selection.
// ---------------------------------------------------------------------------

export interface DocAction {
  id: string;
  label: string;
  icon: string;
  buildMessages(docContent: string): AIMessage[];
}

export const DOC_ACTIONS: DocAction[] = [
  {
    id: "doc-summarize",
    label: "Summarize doc",
    icon: "📝",
    buildMessages(docContent) {
      return msg(
        "You are an expert at summarizing Markdown documents. " +
          "Produce a concise bullet-point summary of the key points. " +
          "Use markdown bullet points. Be helpful and thorough.",
        `Summarize this document:\n\n${docContent}`,
      );
    },
  },
  {
    id: "doc-outline",
    label: "Outline",
    icon: "📋",
    buildMessages(docContent) {
      return msg(
        "You are an expert document analyst. " +
          "Produce a structured outline of the document as a nested markdown list " +
          "reflecting the heading hierarchy. Include one brief sentence per section " +
          "describing its content.",
        `Generate an outline for this document:\n\n${docContent}`,
      );
    },
  },
  {
    id: "doc-explain-selection",
    label: "Explain selection",
    icon: "💡",
    buildMessages(docContent) {
      return msg(
        "You are a clear, concise technical explainer grounded in the document context. " +
          "The user will provide selected text. Explain it in plain language, " +
          "referencing the surrounding document for context as needed.",
        `The document context:\n\n${docContent}`,
      );
    },
  },
];
