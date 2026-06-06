/**
 * DigestCard.tsx — the "Since you last looked" briefing surface.
 *
 * Renders the on-device Agent Activity Digest at the top of the app on launch:
 * an AI summary of what changed in the watched folder while you were away, with
 * one click to review. The recurring return ritual (see digestStore).
 */

import { useDigestStore } from "../store/digestStore";
import { useUiStore } from "../store/uiStore";
import "../styles/digest.css";

export function DigestCard() {
  const status = useDigestStore((s) => s.status);
  const summary = useDigestStore((s) => s.summary);
  const files = useDigestStore((s) => s.changedFiles);
  const dismiss = useDigestStore((s) => s.dismiss);
  const openActivity = useUiStore((s) => s.openActivity);

  if (status === "hidden") return null;

  const n = files.length;
  const fileWord = n === 1 ? "file" : "files";

  return (
    <div className="digest-card" role="status" aria-live="polite">
      <div className="digest-card__head">
        <span className="digest-card__title">
          <span className="digest-card__spark" aria-hidden="true">
            ✦
          </span>
          Since you last looked
        </span>
        <button
          type="button"
          className="digest-card__close"
          onClick={dismiss}
          aria-label="Dismiss digest"
        >
          ✕
        </button>
      </div>

      <div className="digest-card__body">
        {status === "computing" ? (
          <span className="digest-card__loading">
            Summarizing {n} changed {fileWord}…
          </span>
        ) : (
          <p className="digest-card__summary">{summary}</p>
        )}
      </div>

      {status === "ready" && (
        <div className="digest-card__actions">
          <button
            type="button"
            className="banner-btn banner-btn-primary"
            onClick={() => {
              openActivity();
              dismiss();
            }}
          >
            Review {n} {fileWord}
          </button>
        </div>
      )}
    </div>
  );
}
