// AI provider abstraction — types shared across the entire AI subsystem.

// ---------------------------------------------------------------------------
// Message wire format (compatible with OpenAI-style and Anthropic chat APIs)
// ---------------------------------------------------------------------------

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// Provider capability descriptor — describes what a resolved provider can do
// and which tier it sits in.  The UI uses this to render the privacy badge.
// ---------------------------------------------------------------------------

export interface AICapabilities {
  /** 0 = Apple Foundation Models (on-device, macOS 26+)
   *  1 = Ollama (local, free)
   *  2 = Bring-your-own cloud key (Anthropic)
   *  3 = Hosted/premium endpoint (not yet active)
   */
  tier: 0 | 1 | 2 | 3;
  /** Human-readable model name, e.g. "llama3.2" or "claude-haiku-4-5" */
  modelName: string;
  /** true for tiers 0 and 1 — network calls never leave the machine */
  isLocal: boolean;
  /** true for tiers 0 and 1 — no API key or subscription required */
  isFree: boolean;
  /** Whether this provider supports streaming token deltas */
  streaming: boolean;
}

// ---------------------------------------------------------------------------
// Provider interface — every concrete provider implements this contract.
// generate() is an AsyncGenerator so callers can consume token deltas with
// "for await … of" and honour AbortSignal naturally.
// ---------------------------------------------------------------------------

export interface AIProvider {
  /** Stable identifier, e.g. "apple-fm" | "ollama" | "anthropic" | "hosted" | "noop" */
  readonly id: string;
  readonly capabilities: AICapabilities;

  /** Probe whether this provider is currently usable (model present, key set, etc.) */
  isAvailable(): Promise<boolean>;

  /**
   * Stream a chat completion.
   * Yields text deltas (partial tokens) as they arrive.
   * Throws on hard errors; simply returns when done.
   * Respects signal.aborted — implementations should stop generating on abort.
   */
  generate(
    messages: AIMessage[],
    opts: { signal?: AbortSignal },
  ): AsyncGenerator<string>;
}
