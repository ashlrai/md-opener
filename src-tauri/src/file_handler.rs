//! How files reach the app.
//!
//! On macOS, double-clicking a `.md` file (or "Open With", or dragging onto the
//! dock icon) delivers a `RunEvent::Opened` to the running process. On first
//! launch the webview may not be ready yet, so opened paths are buffered in
//! [`PendingFiles`]; the frontend drains the buffer via [`take_pending_files`]
//! once it has mounted, and also listens for the live `file-opened` event for
//! files opened while the app is already running.

use crate::PendingFiles;
use tauri::{AppHandle, Manager};

// Emitter and Url are only needed by the macOS-only handle_opened path.
#[cfg(target_os = "macos")]
use tauri::{Emitter, Url};

/// Convert opened URLs into absolute file paths, buffer them, and notify the
/// frontend. Called from the `RunEvent::Opened` arm of the run loop.
///
/// macOS only — other platforms receive files as CLI args (see
/// [`buffer_cli_args`]) and deep links via the deep-link plugin.
#[cfg(target_os = "macos")]
pub fn handle_opened(app: &AppHandle, urls: Vec<Url>) {
    let paths: Vec<String> = urls
        .iter()
        .filter_map(|u| u.to_file_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect();

    if paths.is_empty() {
        return;
    }

    {
        let state = app.state::<PendingFiles>();
        let mut buf = state.0.lock().unwrap();
        buf.extend(paths.clone());
    }

    // Emit for the already-running case. Harmless if no listener is attached yet
    // — the buffered copy in PendingFiles is the fallback for cold launches.
    let _ = app.emit("file-opened", paths);
}

/// Buffer file paths passed as CLI arguments at launch (covers `mdopen file.md`
/// and non-macOS platforms where files arrive as argv rather than RunEvent).
pub fn buffer_cli_args(app: &AppHandle) {
    let args: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter_map(|a| {
            std::fs::canonicalize(&a)
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
        })
        .collect();

    if args.is_empty() {
        return;
    }

    let state = app.state::<PendingFiles>();
    let mut buf = state.0.lock().unwrap();
    buf.extend(args);
}

/// Drain and return any buffered file paths. The frontend calls this once on
/// mount to pick up files that were opened before the webview was ready.
#[tauri::command]
pub fn take_pending_files(state: tauri::State<PendingFiles>) -> Vec<String> {
    let mut buf = state.0.lock().unwrap();
    std::mem::take(&mut *buf)
}
