//! Apple Foundation Models bridge — spawns and communicates with the
//! `mdopener-afm` Swift sidecar via stdin/stdout JSON-Lines.
//!
//! The sidecar is a long-lived process: we spawn it lazily on the first call
//! and keep it running.  Requests are serialised through a Mutex so the sidecar
//! only ever sees one request at a time, matching its simple single-threaded
//! request loop.
//!
//! Event protocol (identical to ai.rs — JS listens on the same channels):
//!   "ai://delta"  { requestId: String, delta: String }
//!   "ai://done"   { requestId: String }
//!   "ai://error"  { requestId: String, error: String }

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Re-use the DeltaPayload / DonePayload / ErrorPayload types from ai.rs.
// They are not pub there, so we redefine the identical shapes here.
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
struct DeltaPayload {
    #[serde(rename = "requestId")]
    request_id: String,
    delta: String,
}

#[derive(Clone, Serialize)]
struct DonePayload {
    #[serde(rename = "requestId")]
    request_id: String,
}

#[derive(Clone, Serialize)]
struct ErrorPayload {
    #[serde(rename = "requestId")]
    request_id: String,
    error: String,
}

// ---------------------------------------------------------------------------
// Message wire type (mirrors ai.rs::Msg and TypeScript AIMessage)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AfmMsg {
    pub role: String,
    pub content: String,
}

// ---------------------------------------------------------------------------
// JSON-Lines types exchanged with the Swift sidecar
// ---------------------------------------------------------------------------

/// The first line the sidecar writes on startup.
#[derive(Deserialize)]
struct SidecarInit {
    available: bool,
    reason: Option<String>,
    model: Option<String>,
}

/// A request we write to the sidecar's stdin (one JSON line).
#[derive(Serialize)]
struct SidecarRequest<'a> {
    id: &'a str,
    messages: &'a [AfmMsg],
    stream: bool,
}

/// Lines the sidecar writes per request.
#[derive(Deserialize)]
#[allow(dead_code)] // some fields are only read off the init line / via serde
struct SidecarLine {
    id: Option<String>,
    delta: Option<String>,
    done: Option<bool>,
    error: Option<String>,
    // Fields present only in the init line — ignored after startup.
    available: Option<bool>,
    reason: Option<String>,
    model: Option<String>,
}

// ---------------------------------------------------------------------------
// Sidecar state — stored in Tauri's managed state
// ---------------------------------------------------------------------------

pub(crate) struct SidecarProcess {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    _child: Child, // kept alive; dropped when the app exits
    model_name: String,
}

/// Tauri managed state: either the running sidecar or the reason it is not
/// available.  None means we haven't tried yet (lazy init).
pub struct AfmState(pub Mutex<Option<AfmStateInner>>);

pub enum AfmStateInner {
    Available(SidecarProcess),
    Unavailable(String), // human-readable reason
}

impl Default for AfmState {
    fn default() -> Self {
        AfmState(Mutex::new(None))
    }
}

// ---------------------------------------------------------------------------
// Sidecar binary location
// ---------------------------------------------------------------------------

/// Find the `mdopener-afm` binary.
///
/// Search order:
///   1. Next to the app bundle resources (production Tauri bundle).
///   2. `src-tauri/target/release/mdopener-afm` relative to the binary
///      (works for `tauri dev` which puts the Tauri binary in target/debug).
///   3. The same directory as the running Tauri binary (fallback).
fn find_sidecar_binary(app: &AppHandle) -> Option<PathBuf> {
    // 1. Tauri resource directory (production bundle).
    if let Ok(res_dir) = app.path().resource_dir() {
        let candidate = res_dir.join("mdopener-afm");
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // 2. Relative to the running binary: go up to workspace root and look in
    //    target/release.  Works when `cargo tauri dev` puts the binary at
    //    src-tauri/target/debug/md-opener.
    if let Ok(exe) = std::env::current_exe() {
        // target/debug/md-opener  ->  target/release/mdopener-afm
        if let Some(target_dir) = exe.parent().and_then(|p| p.parent()) {
            let candidate = target_dir.join("release").join("mdopener-afm");
            if candidate.exists() {
                return Some(candidate);
            }
            // Also try same profile dir (in case someone built release and runs release).
            let candidate2 = exe.parent().unwrap().join("mdopener-afm");
            if candidate2.exists() {
                return Some(candidate2);
            }
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Lazy sidecar initialisation
// ---------------------------------------------------------------------------

/// Initialise the sidecar if not already done.
/// Returns Ok(model_name) if available, Err(reason) if not.
fn ensure_sidecar(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<AfmState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    match &*guard {
        Some(AfmStateInner::Available(proc)) => return Ok(proc.model_name.clone()),
        Some(AfmStateInner::Unavailable(reason)) => return Err(reason.clone()),
        None => {} // fall through to init
    }

    // First call — spawn the sidecar.
    let bin = find_sidecar_binary(app)
        .ok_or_else(|| "mdopener-afm binary not found (run src-tauri/bins/mdopener-afm/build.sh first)".to_string())?;

    let mut child = Command::new(&bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit()) // forward Swift stderr to Tauri's stderr
        .spawn()
        .map_err(|e| format!("Failed to spawn mdopener-afm: {e}"))?;

    let stdin = child.stdin.take().ok_or("sidecar has no stdin")?;
    let stdout_raw = child.stdout.take().ok_or("sidecar has no stdout")?;
    let mut stdout = BufReader::new(stdout_raw);

    // Read the mandatory init line.
    let mut init_line = String::new();
    stdout
        .read_line(&mut init_line)
        .map_err(|e| format!("Failed to read sidecar init line: {e}"))?;

    let init: SidecarInit = serde_json::from_str(init_line.trim())
        .map_err(|e| format!("Failed to parse sidecar init JSON: {e} (got: {init_line:?})"))?;

    if !init.available {
        let reason = init
            .reason
            .unwrap_or_else(|| "Apple Foundation Models unavailable".to_string());
        *guard = Some(AfmStateInner::Unavailable(reason.clone()));
        // Kill the sidecar (it already exited, but be tidy).
        let _ = child.wait();
        return Err(reason);
    }

    let model_name = init
        .model
        .unwrap_or_else(|| "Apple Foundation Models".to_string());

    *guard = Some(AfmStateInner::Available(SidecarProcess {
        stdin,
        stdout,
        _child: child,
        model_name: model_name.clone(),
    }));

    Ok(model_name)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Probe Apple Foundation Models availability.
/// Returns Some(model_name) if available, None if not.
/// Mirrors `ai_detect_ollama` in ai.rs.
#[tauri::command]
pub async fn afm_detect(app: AppHandle) -> Result<Option<String>, String> {
    match ensure_sidecar(&app) {
        Ok(name) => Ok(Some(name)),
        Err(reason) => {
            // Log the reason at debug level but return None (not an error)
            // so the provider chain falls through gracefully.
            eprintln!("[afm] not available: {reason}");
            Ok(None)
        }
    }
}

/// Stream a generation from Apple Foundation Models.
/// Results arrive via "ai://delta" / "ai://done" / "ai://error" Tauri events,
/// exactly matching the protocol used by ai_generate in ai.rs.
///
/// Returns Ok(()) immediately after spawning the streaming task.
#[tauri::command]
pub async fn afm_generate(
    app: AppHandle,
    messages: Vec<AfmMsg>,
    request_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = do_generate(app.clone(), messages, request_id.clone()).await {
            let _ = app.emit("ai://error", ErrorPayload { request_id, error: e });
        }
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Internal: send a request to the sidecar and forward response events
// ---------------------------------------------------------------------------

async fn do_generate(
    app: AppHandle,
    messages: Vec<AfmMsg>,
    request_id: String,
) -> Result<(), String> {
    // Ensure the sidecar is running; this may block briefly on first call.
    ensure_sidecar(&app)?;

    let state = app.state::<AfmState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    let proc = match &mut *guard {
        Some(AfmStateInner::Available(p)) => p,
        Some(AfmStateInner::Unavailable(r)) => {
            return Err(format!("Apple Foundation Models unavailable: {r}"))
        }
        None => return Err("afm sidecar not initialised".to_string()),
    };

    // Serialise the request as a single JSON line.
    let req = SidecarRequest {
        id: &request_id,
        messages: &messages,
        stream: true,
    };
    let mut req_line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
    req_line.push('\n');

    proc.stdin
        .write_all(req_line.as_bytes())
        .map_err(|e| format!("Failed to write to sidecar stdin: {e}"))?;
    proc.stdin
        .flush()
        .map_err(|e| format!("Failed to flush sidecar stdin: {e}"))?;

    // Read response lines until we see done=true or error.
    loop {
        let mut line = String::new();
        let n = proc
            .stdout
            .read_line(&mut line)
            .map_err(|e| format!("Failed to read from sidecar stdout: {e}"))?;

        if n == 0 {
            // Sidecar closed stdout unexpectedly.
            return Err("mdopener-afm sidecar closed stdout unexpectedly".to_string());
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parsed: SidecarLine = serde_json::from_str(trimmed)
            .map_err(|e| format!("Failed to parse sidecar response: {e} (line: {trimmed:?})"))?;

        // Only process lines belonging to this request.
        if parsed.id.as_deref() != Some(&request_id) {
            // Shouldn't happen (single-request serialisation), but skip safely.
            continue;
        }

        if let Some(delta) = parsed.delta {
            if !delta.is_empty() {
                let _ = app.emit(
                    "ai://delta",
                    DeltaPayload {
                        request_id: request_id.clone(),
                        delta,
                    },
                );
            }
        }

        if parsed.done == Some(true) {
            let _ = app.emit("ai://done", DonePayload { request_id });
            return Ok(());
        }

        if let Some(err) = parsed.error {
            return Err(err);
        }
    }
}
