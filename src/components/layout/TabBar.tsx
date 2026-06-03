import "../../styles/tabbar.css";
import { useDocumentStore } from "../../store/documentStore";

/** Small × glyph for the per-tab close button. */
function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M3 3l6 6M9 3l-6 6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Horizontal strip of open documents. Renders NOTHING when fewer than two tabs
 * are open, so the single-document layout is visually identical to before.
 *
 * Each tab is a flex row holding two real <button>s — one that fills the row to
 * switch, and a close button — so we never nest interactive elements and both
 * affordances are keyboard-reachable.
 */
export function TabBar() {
  const tabs = useDocumentStore((s) => s.tabs);
  const activeId = useDocumentStore((s) => s.activeId);
  const switchTab = useDocumentStore((s) => s.switchTab);
  const closeTab = useDocumentStore((s) => s.closeTab);

  if (tabs.length < 2) return null;

  return (
    <div className="tabbar" role="tablist" aria-label="Open documents">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={`tab${active ? " active" : ""}`}
            title={tab.path}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="tab-switch"
              onClick={() => switchTab(tab.id)}
              onAuxClick={(e) => {
                // Middle-click closes, matching browser-tab convention.
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.id);
                }
              }}
            >
              {tab.isDirty && (
                <span className="tab-dirty" aria-label="Unsaved changes" />
              )}
              <span className="tab-name">{tab.fileName || "Untitled"}</span>
            </button>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${tab.fileName || "tab"}`}
              onClick={() => closeTab(tab.id)}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}
