import { useMemo } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { THEMES, useSettingsStore } from "../../store/settingsStore";

export function StatusBar() {
  const path = useDocumentStore((s) => s.path);
  const content = useDocumentStore((s) => s.content);
  const isDirty = useDocumentStore((s) => s.isDirty);
  const theme = useSettingsStore((s) => s.theme);
  const themeLabel = THEMES.find((t) => t.id === theme)?.label ?? "";

  const stats = useMemo(() => {
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const minutes = Math.max(1, Math.round(words / 220));
    return { words, minutes };
  }, [content]);

  if (!path) {
    return (
      <footer className="statusbar">
        <span className="spacer" />
        <span className="status-item">{themeLabel}</span>
      </footer>
    );
  }

  return (
    <footer className="statusbar">
      <span className="status-item">{stats.words.toLocaleString()} words</span>
      <span className="status-item">{stats.minutes} min read</span>
      <span className="spacer" />
      <span className="status-item">{isDirty ? "Unsaved — ⌘S to save" : "Saved"}</span>
      <span className="status-item">{themeLabel}</span>
    </footer>
  );
}
