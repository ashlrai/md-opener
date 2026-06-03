//! Run a shell command from a fenced code block.
//!
//! Only invoked after the user explicitly confirms in the UI (the renderer
//! shows a "Run this command?" prompt). Runs the user's own document's code on
//! their own machine — there is no implicit/automatic execution.

use serde::Serialize;
use tokio::process::Command;

#[derive(Serialize)]
pub struct RunOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

/// Execute `cmd` via `sh -c` and capture its output. Runs on Tokio so it
/// never blocks the UI thread.
#[tauri::command]
pub async fn run_shell(cmd: String) -> Result<RunOutput, String> {
    let output = Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .output()
        .await
        .map_err(|e| format!("Failed to run command: {e}"))?;

    Ok(RunOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        success: output.status.success(),
    })
}
