//! Document file I/O: reading and (atomically) writing Markdown files.

use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct MarkdownFile {
    pub path: String,
    pub file_name: String,
    pub content: String,
    /// Size in bytes — the frontend uses this to decide whether to default
    /// a very large document into the lighter source-only view.
    pub size: u64,
}

/// Read a Markdown file from disk and return its content plus light metadata.
#[tauri::command]
pub fn read_markdown_file(path: String) -> Result<MarkdownFile, String> {
    let p = Path::new(&path);
    let content = std::fs::read_to_string(p).map_err(|e| format!("Could not read {path}: {e}"))?;
    let size = content.len() as u64;
    let file_name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled.md".to_string());
    Ok(MarkdownFile {
        path,
        file_name,
        content,
        size,
    })
}

/// Write a Markdown file atomically: write to a sibling temp file, then rename.
/// Renaming on the same filesystem is atomic, so a crash mid-write never leaves
/// a half-written document on disk.
#[tauri::command]
pub fn write_markdown_file(path: String, content: String) -> Result<(), String> {
    let tmp = format!("{path}.mdopener.tmp");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("Could not write {path}: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        // Best-effort cleanup of the temp file if the rename failed.
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save {path}: {e}")
    })?;
    Ok(())
}
