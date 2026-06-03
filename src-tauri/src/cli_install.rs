//! Install the `mdopen` CLI helper into a standard system PATH location.
//!
//! The command tries `/usr/local/bin` first (writable on developer machines),
//! and falls back to `~/.local/bin` (always writable, XDG convention).  In
//! both cases it creates a symlink pointing at the sidecar binary that Tauri
//! bundles alongside the app.
//!
//! Wire a "Install CLI tool" button in Preferences to:
//! ```ts
//! import { invoke } from "@tauri-apps/api/core";
//! const path = await invoke<string>("install_cli");
//! alert(`mdopen installed at ${path}`);
//! ```

use std::path::{Path, PathBuf};
use tauri::Manager;

/// Attempt to install the `mdopen` sidecar as a CLI tool on `$PATH`.
///
/// Returns the absolute path where the binary was linked/copied on success.
#[tauri::command]
pub fn install_cli(app: tauri::AppHandle) -> Result<String, String> {
    // Locate the bundled sidecar.  Tauri places sidecars next to the app binary.
    let sidecar_path = find_sidecar(&app)?;

    // Candidate install directories, in preference order.
    let candidates: &[&str] = &["/usr/local/bin", "~/.local/bin"];

    for &dir_str in candidates {
        let dir = expand_tilde(dir_str);
        match try_install(&sidecar_path, &dir) {
            Ok(dest) => return Ok(dest.to_string_lossy().into_owned()),
            Err(_) => continue,
        }
    }

    Err(
        "Could not install mdopen: neither /usr/local/bin nor ~/.local/bin is writable. \
         Try: sudo cp \"$(path to sidecar)\" /usr/local/bin/mdopen"
            .to_string(),
    )
}

/// Locate the `mdopen` sidecar binary that Tauri bundles with the app.
fn find_sidecar(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // `resource_dir()` is where Tauri places bundled resources / sidecars.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Could not resolve resource directory: {e}"))?;

    // Tauri sidecar naming convention: <binary-name>-<target-triple>
    // For local dev (cargo run) the binary lives next to the app executable.
    let app_exe = std::env::current_exe()
        .map_err(|e| format!("Could not determine app executable path: {e}"))?;
    let app_dir = app_exe
        .parent()
        .ok_or("App executable has no parent directory")?;

    // Search order: resources dir (bundled), then same dir as app binary (dev).
    let candidates = [
        resource_dir.join("mdopen"),
        app_dir.join("mdopen"),
    ];

    for candidate in &candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "mdopen sidecar not found. Looked in: {}, {}",
        candidates[0].display(),
        candidates[1].display()
    ))
}

/// Attempt to create a symlink (preferred) or copy the binary into `dir`.
fn try_install(src: &Path, dir: &Path) -> Result<PathBuf, std::io::Error> {
    std::fs::create_dir_all(dir)?;

    let dest = dir.join("mdopen");

    // Remove a stale symlink or binary first (idempotent).
    if dest.exists() || dest.symlink_metadata().is_ok() {
        std::fs::remove_file(&dest)?;
    }

    // Prefer symlinks: the sidecar is updated in-place when the app updates.
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(src, &dest)?;
    }
    #[cfg(not(unix))]
    {
        std::fs::copy(src, &dest)?;
    }

    Ok(dest)
}

/// Expand a leading `~` to the user's home directory.
fn expand_tilde(s: &str) -> PathBuf {
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(s)
}
