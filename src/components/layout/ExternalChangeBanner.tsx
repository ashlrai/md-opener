import { useDocumentStore } from "../../store/documentStore";

/** Shown when the open file changed on disk while we hold unsaved edits. */
export function ExternalChangeBanner() {
  const accept = useDocumentStore((s) => s.acceptExternalChange);
  const dismiss = useDocumentStore((s) => s.dismissExternalChange);

  return (
    <div className="change-banner">
      <span className="change-banner-text">
        This file changed on disk and you have unsaved edits.
      </span>
      <div className="change-banner-actions">
        <button type="button" className="banner-btn" onClick={() => dismiss()}>
          Keep mine
        </button>
        <button
          type="button"
          className="banner-btn banner-btn-primary"
          onClick={() => accept()}
        >
          Reload from disk
        </button>
      </div>
    </div>
  );
}
