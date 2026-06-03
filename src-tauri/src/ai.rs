//! AI provider bridge — Tauri commands that proxy LLM requests via reqwest.
//!
//! All HTTP calls live here (not in the webview) to avoid CORS restrictions
//! and to keep API keys out of the browser context.
//!
//! Supported providers:
//!   - "ollama"     — local Ollama server at http://localhost:11434
//!   - "anthropic"  — Anthropic Messages API (SSE streaming)
//!
//! Event protocol (JS listens on these channels):
//!   "ai://delta"  { requestId: String, delta: String }   — token chunk
//!   "ai://done"   { requestId: String }                  — stream complete
//!   "ai://error"  { requestId: String, error: String }   — hard error

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------------------
// Shared message type (mirrors TypeScript AIMessage)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Msg {
    pub role: String,
    pub content: String,
}

// ---------------------------------------------------------------------------
// Tauri event payload structs
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
// Ollama response types (NDJSON streaming)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Deserialize)]
struct OllamaModel {
    name: String,
}

#[derive(Deserialize)]
struct OllamaChatChunk {
    message: Option<OllamaChatMessage>,
    done: Option<bool>,
}

#[derive(Deserialize)]
struct OllamaChatMessage {
    content: String,
}

// ---------------------------------------------------------------------------
// Anthropic response types (SSE)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct AnthropicContentDelta {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicStreamEvent {
    #[serde(rename = "type")]
    kind: String,
    delta: Option<AnthropicContentDelta>,
}

// ---------------------------------------------------------------------------
// Ollama preferred model order
// ---------------------------------------------------------------------------

const OLLAMA_PREFERRED: &[&str] = &["llama3.2", "llama3.1", "qwen2.5", "mistral", "phi3"];

/// Probe Ollama at localhost:11434.  Returns the best available model name
/// (by OLLAMA_PREFERRED order, then first installed), or None.
#[tauri::command]
pub async fn ai_detect_ollama() -> Result<Option<String>, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map_err(|_| "Ollama not reachable".to_string())?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let body: OllamaTagsResponse = resp.json().await.map_err(|e| e.to_string())?;
    if body.models.is_empty() {
        return Ok(None);
    }

    // Normalise model names (strip ":latest" suffix for comparison).
    let names: Vec<String> = body
        .models
        .iter()
        .map(|m| m.name.split(':').next().unwrap_or(&m.name).to_string())
        .collect();

    // Pick by preference order first.
    for preferred in OLLAMA_PREFERRED {
        if let Some(full) = body.models.iter().find(|m| {
            let base = m.name.split(':').next().unwrap_or(&m.name);
            base.starts_with(preferred)
        }) {
            return Ok(Some(full.name.clone()));
        }
    }

    // Fall back to first available.
    drop(names); // silence unused warning
    Ok(Some(body.models[0].name.clone()))
}

// ---------------------------------------------------------------------------
// Main generation command
// ---------------------------------------------------------------------------

/// Stream a chat completion.  Results are delivered via Tauri events rather
/// than the return value so the frontend can start rendering immediately.
///
/// The command returns Ok(()) as soon as the stream task is spawned — the
/// actual data arrives via "ai://delta" / "ai://done" / "ai://error" events.
#[tauri::command]
pub async fn ai_generate(
    app: AppHandle,
    provider: String,
    model: String,
    api_key: Option<String>,
    messages: Vec<Msg>,
    request_id: String,
) -> Result<(), String> {
    // Spawn onto the async runtime so the command returns immediately.
    tauri::async_runtime::spawn(async move {
        let result = match provider.as_str() {
            "ollama" => stream_ollama(app.clone(), model, messages, request_id.clone()).await,
            "anthropic" => {
                let key = api_key.unwrap_or_default();
                stream_anthropic(app.clone(), model, key, messages, request_id.clone()).await
            }
            other => Err(format!("Unknown provider: {other}")),
        };

        if let Err(e) = result {
            let _ = app.emit(
                "ai://error",
                ErrorPayload {
                    request_id,
                    error: e,
                },
            );
        }
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Ollama streaming
// ---------------------------------------------------------------------------

async fn stream_ollama(
    app: AppHandle,
    model: String,
    messages: Vec<Msg>,
    request_id: String,
) -> Result<(), String> {
    let client = Client::new();

    #[derive(Serialize)]
    struct OllamaChatRequest {
        model: String,
        messages: Vec<Msg>,
        stream: bool,
    }

    let body = OllamaChatRequest {
        model,
        messages,
        stream: true,
    };

    let resp = client
        .post("http://localhost:11434/api/chat")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error {status}: {text}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {e}"))?;
        let text = String::from_utf8_lossy(&chunk);
        buf.push_str(&text);

        // NDJSON — process complete lines.
        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].trim().to_string();
            buf = buf[nl + 1..].to_string();
            if line.is_empty() {
                continue;
            }
            if let Ok(chunk_obj) = serde_json::from_str::<OllamaChatChunk>(&line) {
                if let Some(msg) = chunk_obj.message {
                    if !msg.content.is_empty() {
                        let _ = app.emit(
                            "ai://delta",
                            DeltaPayload {
                                request_id: request_id.clone(),
                                delta: msg.content,
                            },
                        );
                    }
                }
                if chunk_obj.done == Some(true) {
                    let _ = app.emit("ai://done", DonePayload { request_id: request_id.clone() });
                    return Ok(());
                }
            }
        }
    }

    // Stream ended without an explicit done marker — emit done anyway.
    let _ = app.emit("ai://done", DonePayload { request_id });
    Ok(())
}

// ---------------------------------------------------------------------------
// Anthropic SSE streaming
// ---------------------------------------------------------------------------

/// Default model constant — easy to update when Anthropic releases new versions.
// The Anthropic model is chosen on the frontend and passed in per request.
/// API version header required by Anthropic.
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Endpoint.
const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
/// Max tokens for responses.
const ANTHROPIC_MAX_TOKENS: u32 = 4096;

async fn stream_anthropic(
    app: AppHandle,
    model: String,
    api_key: String,
    messages: Vec<Msg>,
    request_id: String,
) -> Result<(), String> {
    let client = Client::new();

    // Separate system messages from user/assistant turns (Anthropic API requirement).
    let system_content: String = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    let chat_messages: Vec<&Msg> = messages.iter().filter(|m| m.role != "system").collect();

    #[derive(Serialize)]
    struct AnthropicRequest<'a> {
        model: String,
        max_tokens: u32,
        system: String,
        messages: Vec<&'a Msg>,
        stream: bool,
    }

    let body = AnthropicRequest {
        model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system: system_content,
        messages: chat_messages,
        stream: true,
    };

    let resp = client
        .post(ANTHROPIC_URL)
        .header("x-api-key", &api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Anthropic error {status}: {text}"));
    }

    // Anthropic streams SSE.  Lines look like:
    //   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete SSE lines.
        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].trim().to_string();
            buf = buf[nl + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    let _ = app.emit("ai://done", DonePayload { request_id: request_id.clone() });
                    return Ok(());
                }
                if let Ok(event) = serde_json::from_str::<AnthropicStreamEvent>(data) {
                    match event.kind.as_str() {
                        "content_block_delta" => {
                            if let Some(delta) = event.delta {
                                if delta.kind == "text_delta" {
                                    if let Some(text) = delta.text {
                                        if !text.is_empty() {
                                            let _ = app.emit(
                                                "ai://delta",
                                                DeltaPayload {
                                                    request_id: request_id.clone(),
                                                    delta: text,
                                                },
                                            );
                                        }
                                    }
                                }
                            }
                        }
                        "message_stop" => {
                            let _ = app.emit(
                                "ai://done",
                                DonePayload { request_id: request_id.clone() },
                            );
                            return Ok(());
                        }
                        "error" => {
                            return Err(format!("Anthropic stream error: {data}"));
                        }
                        _ => {} // ping, message_start, content_block_start, etc.
                    }
                }
            }
        }
    }

    // Stream ended — emit done.
    let _ = app.emit("ai://done", DonePayload { request_id });
    Ok(())
}
