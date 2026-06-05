import { beforeEach, describe, expect, it } from "vitest";
import { useActivationStore } from "./activationStore";

function reset() {
  useActivationStore.setState({
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
  });
}

describe("activationStore", () => {
  beforeEach(reset);

  it("markActivated sets activatedAt + watchStartedAt once (idempotent)", () => {
    const s = useActivationStore.getState();
    s.markActivated();
    const first = useActivationStore.getState().activatedAt;
    expect(first).not.toBeNull();
    s.markActivated();
    expect(useActivationStore.getState().activatedAt).toBe(first); // unchanged
  });

  it("touchLastSeen returns the PRIOR value then records now (drives the digest)", () => {
    expect(useActivationStore.getState().touchLastSeen()).toBeNull(); // first launch
    const recorded = useActivationStore.getState().lastSeenAt;
    expect(recorded).not.toBeNull();
    // Second launch sees the prior timestamp.
    expect(useActivationStore.getState().touchLastSeen()).toBe(recorded);
  });

  it("markEvent records each milestone once", () => {
    const s = useActivationStore.getState();
    s.markEvent("setDefault");
    const t = useActivationStore.getState().setDefaultAt;
    expect(t).not.toBeNull();
    s.markEvent("setDefault");
    expect(useActivationStore.getState().setDefaultAt).toBe(t);
  });

  it("dismissAgentPrompt flips the gate", () => {
    expect(useActivationStore.getState().agentPromptDismissed).toBe(false);
    useActivationStore.getState().dismissAgentPrompt();
    expect(useActivationStore.getState().agentPromptDismissed).toBe(true);
  });
});
