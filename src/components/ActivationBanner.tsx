/**
 * ActivationBanner.tsx — the agent-aware first-run nudge.
 *
 * When a brand-new user opens a file Ashlr recognizes as agent output (a plan,
 * diff, or multi-file doc) and they haven't yet watched a folder, offer one
 * click to watch that file's folder — turning a one-shot open into the standing
 * "Ashlr is where my agent's work lands" loop. Shows once; dismissible.
 */

import { useMemo } from "react";
import { unwatchDirectory } from "../lib/activity";
import { detectDocKind } from "../lib/agent-detect";
import { useActivationStore } from "../store/activationStore";
import { useActivityStore } from "../store/activityStore";
import { useDocumentStore } from "../store/documentStore";
import { useUiStore } from "../store/uiStore";

function dirOf(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const i = path.lastIndexOf(sep);
  // i===0 means a root-level file ("/note.md") — its folder is the root, not itself.
  return i > 0 ? path.slice(0, i) : i === 0 ? sep : path;
}

export function ActivationBanner() {
  const activatedAt = useActivationStore((s) => s.activatedAt);
  const dismissed = useActivationStore((s) => s.agentPromptDismissed);
  const dismiss = useActivationStore((s) => s.dismissAgentPrompt);
  const path = useDocumentStore((s) => s.path);
  const content = useDocumentStore((s) => s.content);
  const watchedDir = useActivityStore((s) => s.watchedDir);
  const setWatchedDir = useActivityStore((s) => s.setWatchedDir);
  const openActivity = useUiStore((s) => s.openActivity);

  const kind = useMemo(() => detectDocKind(content).kind, [content]);
  const isAgentDoc = kind === "plan" || kind === "diff" || kind === "multi-file";

  // Show only for a first-time user, on a recognized agent doc with a folder,
  // and only if they aren't already watching one (guards a wiped activationStore).
  if (activatedAt != null || dismissed || !path || !isAgentDoc || watchedDir) {
    return null;
  }

  const folder = dirOf(path);

  return (
    <div className="change-banner" role="status">
      <span className="change-banner-text">
        Ashlr spotted an agent {kind}. Watch this folder to catch new ones live.
      </span>
      <div className="change-banner-actions">
        <button
          type="button"
          className="banner-btn banner-btn-primary"
          onClick={async () => {
            // Mirror the command flow: stop any prior watch, set the new folder
            // (marks activation), then open the drawer (which starts the watch).
            await unwatchDirectory().catch(() => {});
            setWatchedDir(folder);
            openActivity();
          }}
        >
          Watch this folder
        </button>
        <button
          type="button"
          className="banner-btn"
          onClick={() => dismiss()}
          aria-label="Dismiss this suggestion"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
