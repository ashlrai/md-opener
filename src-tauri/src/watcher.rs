//! Watches the currently open file for external changes.
//!
//! We watch the file's PARENT directory (not the file inode) and filter by
//! path, because many editors save atomically by writing a temp file and
//! renaming it — which changes the inode and would be missed by a direct
//! file watch. On a relevant event we emit `file-changed`; the frontend then
//! re-reads the file and decides whether to reload or flag a conflict.

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct FileWatcher(pub Mutex<Option<RecommendedWatcher>>);

/// Begin watching `path`, replacing any previous watch.
#[tauri::command]
pub fn watch_file(
    app: AppHandle,
    path: String,
    state: tauri::State<FileWatcher>,
) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let parent = target
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "file has no parent directory".to_string())?;

    let target_for_cb = target.clone();
    let app_for_cb = app.clone();

    let mut watcher = notify::recommended_watcher(
        move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            if matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
            ) && event.paths.iter().any(|p| p == &target_for_cb)
            {
                let _ = app_for_cb
                    .emit("file-changed", target_for_cb.to_string_lossy().to_string());
            }
        },
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    *state.0.lock().unwrap() = Some(watcher);
    Ok(())
}

/// Stop watching (e.g. when the document is closed).
#[tauri::command]
pub fn unwatch_file(state: tauri::State<FileWatcher>) {
    *state.0.lock().unwrap() = None;
}
