import { useMemo } from "react";
import { detectDocKind } from "../../lib/agent-detect";
import { computeDocStats } from "../../lib/wordcount";
import { useDocumentStore } from "../../store/documentStore";
import { THEMES, useSettingsStore } from "../../store/settingsStore";

export function StatusBar() {
  const path = useDocumentStore((s) => s.path);
  const content = useDocumentStore((s) => s.content);
  const isDirty = useDocumentStore((s) => s.isDirty);
  const theme = useSettingsStore((s) => s.theme);
  const themeLabel = THEMES.find((t) => t.id === theme)?.label ?? "";

  const stats = useMemo(() => computeDocStats(content), [content]);
  // Surface live task progress for agent plan/checklist docs (instant payoff).
  const tasks = useMemo(() => detectDocKind(content), [content]);

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
      {tasks.taskTotal > 0 && (
        <span className="status-item" title="Checklist progress in this document">
          {tasks.taskDone} / {tasks.taskTotal} tasks
        </span>
      )}
      <span className="spacer" />
      <span className="status-item">{isDirty ? "Unsaved — ⌘S to save" : "Saved"}</span>
      <span className="status-item">{themeLabel}</span>
    </footer>
  );
}
