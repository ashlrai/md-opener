//! Ashlr MD MCP server — stdio JSON-RPC 2.0 bridge for coding agents.
//!
//! Implements the [Model Context Protocol](https://modelcontextprotocol.io/)
//! over stdin/stdout so tools like Claude Code can drive Ashlr MD as a tool.
//!
//! ## IPC
//! The running Ashlr MD app starts a loopback HTTP server and writes its port
//! to `~/.mdopener/ipc-port`.  This binary reads that file to find the app.
//! If the file is absent, most tools return an error; `open_file` is the
//! exception — it can launch the app via the `mdopener://` URL scheme.
//!
//! ## Protocol subset implemented
//!   initialize      → capability handshake
//!   notifications/initialized → ack (no-op)
//!   tools/list      → list available tools
//!   tools/call      → invoke a tool
//!   ping            → {"result":{}}
//!
//! ## Tools
//!   open_file(path, mode?)          open a file in the app
//!   get_current_content()           get current doc path + markdown
//!   set_content(content, save?)     replace current doc content
//!   list_recent(limit?)             recent file list
//!   export(format, output_path?)    trigger an export

use std::io::{self, BufRead, Write as _};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// ── JSON-RPC types ────────────────────────────────────────────────────────────

#[derive(Deserialize, Debug)]
struct Request {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

#[derive(Serialize)]
struct Response {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Serialize)]
struct RpcError {
    code: i32,
    message: String,
}

impl Response {
    fn ok(id: Value, result: Value) -> Self {
        Self { jsonrpc: "2.0", id, result: Some(result), error: None }
    }

    fn err(id: Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(RpcError { code, message: message.into() }),
        }
    }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) if l.trim().is_empty() => continue,
            Ok(l) => l,
            Err(_) => break,
        };

        let response = match serde_json::from_str::<Request>(&line) {
            Ok(req) => dispatch(req),
            Err(e) => Some(Response::err(
                Value::Null,
                -32700,
                format!("Parse error: {e}"),
            )),
        };

        // Notifications (dispatch returned None) get no reply.
        if let Some(response) = response {
            let mut out = serde_json::to_string(&response).unwrap_or_default();
            out.push('\n');
            let _ = stdout.write_all(out.as_bytes());
            let _ = stdout.flush();
        }
    }
}

// ── Method dispatcher ─────────────────────────────────────────────────────────

fn dispatch(req: Request) -> Option<Response> {
    // JSON-RPC notifications (methods under "notifications/", carrying no id)
    // must NOT receive a response. Drop them silently.
    if req.method.starts_with("notifications/") {
        return None;
    }

    let id = req.id.clone().unwrap_or(Value::Null);

    let response = match req.method.as_str() {
        "initialize" => handle_initialize(id, req.params),

        "ping" => Response::ok(id, json!({})),

        "tools/list" => Response::ok(id, json!({ "tools": tool_list() })),

        "tools/call" => {
            let params = req.params.unwrap_or(Value::Null);
            let name = params["name"].as_str().unwrap_or("").to_string();
            let args = params["arguments"].clone();
            handle_tool_call(id, &name, args)
        }

        "resources/list" => handle_resources_list(id),
        "resources/read" => {
            let params = req.params.unwrap_or(Value::Null);
            let uri = params["uri"].as_str().unwrap_or("").to_string();
            handle_resource_read(id, &uri)
        }

        "prompts/list" => Response::ok(id, json!({ "prompts": prompts_list() })),
        "prompts/get" => {
            let params = req.params.unwrap_or(Value::Null);
            let name = params["name"].as_str().unwrap_or("").to_string();
            handle_prompt_get(id, &name)
        }

        other => Response::err(id, -32601, format!("Method not found: {other}")),
    };
    Some(response)
}

// ── initialize ────────────────────────────────────────────────────────────────

/// Protocol revisions this server understands. We echo the client's requested
/// version when it's one of these, else fall back to our baseline.
const SUPPORTED_PROTOCOLS: [&str; 3] = ["2024-11-05", "2025-03-26", "2025-06-18"];
const DEFAULT_PROTOCOL: &str = "2024-11-05";

fn handle_initialize(id: Value, params: Option<Value>) -> Response {
    // Negotiate: honor the client's requested protocolVersion if we support it,
    // otherwise advertise our baseline (per the MCP lifecycle spec).
    let requested = params
        .as_ref()
        .and_then(|p| p["protocolVersion"].as_str());
    let protocol = match requested {
        Some(v) if SUPPORTED_PROTOCOLS.contains(&v) => v,
        _ => DEFAULT_PROTOCOL,
    };

    Response::ok(
        id,
        json!({
            "protocolVersion": protocol,
            "capabilities": {
                "tools": {},
                "resources": {},
                "prompts": {}
            },
            "serverInfo": {
                "name": "mdopener-mcp",
                "version": "0.1.0"
            }
        }),
    )
}

// ── Tool definitions ──────────────────────────────────────────────────────────

fn tool_list() -> Value {
    json!([
        {
            "name": "open_file",
            "description": "Open a Markdown file in Ashlr MD. Launches the app if it is not already running.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute or relative path to the Markdown file to open."
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["read", "edit"],
                        "description": "Initial view mode. Defaults to 'read'."
                    }
                },
                "required": ["path"]
            }
        },
        {
            "name": "get_current_content",
            "description": "Return the path and full Markdown content of the document currently open in Ashlr MD.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "set_content",
            "description": "Replace the content of the currently open document in Ashlr MD.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "The new Markdown content."
                    },
                    "save": {
                        "type": "boolean",
                        "description": "Whether to save the file to disk immediately. Defaults to false."
                    }
                },
                "required": ["content"]
            }
        },
        {
            "name": "list_recent",
            "description": "Return the list of recently opened files.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of entries to return. Defaults to 10."
                    }
                }
            }
        },
        {
            "name": "export",
            "description": "Trigger an export of the currently open document.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "format": {
                        "type": "string",
                        "enum": ["pdf", "docx", "html"],
                        "description": "Export format."
                    },
                    "output_path": {
                        "type": "string",
                        "description": "Optional absolute path for the output file."
                    }
                },
                "required": ["format"]
            }
        },
        {
            "name": "request_review",
            "description": "Surface a Markdown document to the human for review in Ashlr MD and BLOCK until they Approve or Request changes, then return their verdict and comments. Use this for explicit human sign-off on agent-generated plans, diffs, or docs before proceeding.",
            "annotations": { "title": "Request Human Review", "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path to the Markdown file to review." },
                    "content": { "type": "string", "description": "Inline Markdown to review, if no file path is given." },
                    "blocking": { "type": "boolean", "description": "If false, register the review and return immediately. Defaults to true." },
                    "timeout_ms": { "type": "integer", "description": "Max milliseconds to wait for a verdict. Default 300000 (5 min), max 600000." }
                },
                "anyOf": [{ "required": ["path"] }, { "required": ["content"] }]
            }
        },
        {
            "name": "get_user_annotations",
            "description": "Return the human's current review verdict, comments, and task-checkbox states for a document.",
            "annotations": { "title": "Get User Annotations", "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false },
            "inputSchema": {
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Absolute path to the Markdown file." } },
                "required": ["path"]
            }
        },
        {
            "name": "edit_document",
            "description": "Make a precise edit to the currently open document by replacing an EXACT substring. The `find` string must occur exactly once — include enough surrounding context to make it unique, or the edit is refused. Prefer this over replace_document for targeted changes.",
            "annotations": { "title": "Edit Document", "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "find": { "type": "string", "description": "The exact text to replace. Must appear exactly once in the document." },
                    "replace": { "type": "string", "description": "The replacement text." },
                    "save": { "type": "boolean", "description": "Save to disk after editing. Defaults to false." },
                    "path": { "type": "string", "description": "Optional: assert this is the open document (errors if a different file is open)." }
                },
                "required": ["find", "replace"]
            }
        },
        {
            "name": "replace_document",
            "description": "Replace the ENTIRE content of the currently open document. Use edit_document for targeted changes; use this only when rewriting the whole document.",
            "annotations": { "title": "Replace Document", "readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": false },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "content": { "type": "string", "description": "The new full Markdown content." },
                    "save": { "type": "boolean", "description": "Save to disk after replacing. Defaults to false." }
                },
                "required": ["content"]
            }
        },
        {
            "name": "search_vault",
            "description": "Full-text search across the user's vault (the watched folder) and recently opened files. Returns matching files with line numbers and snippets.",
            "annotations": { "title": "Search Vault", "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Text to search for (case-insensitive)." },
                    "limit": { "type": "integer", "description": "Max number of files to return. Defaults to 50." }
                },
                "required": ["query"]
            }
        },
        {
            "name": "present_document",
            "description": "Open a document (if a path is given) and switch Ashlr MD into a distraction-free, full-screen reading presentation — ideal for showing the human a finished result.",
            "annotations": { "title": "Present Document", "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Optional absolute path to open before presenting. Omit to present the current document." }
                }
            }
        }
    ])
}

// ── Tool dispatch ─────────────────────────────────────────────────────────────

fn handle_tool_call(id: Value, name: &str, args: Value) -> Response {
    match name {
        "open_file" => tool_open_file(id, &args),
        "get_current_content" => tool_get_content(id),
        "set_content" => tool_set_content(id, &args),
        "list_recent" => tool_list_recent(id, &args),
        "export" => tool_export(id, &args),
        "request_review" => tool_request_review(id, &args),
        "get_user_annotations" => tool_get_annotations(id, &args),
        "edit_document" => tool_edit_document(id, &args),
        "replace_document" => tool_replace_document(id, &args),
        "search_vault" => tool_search_vault(id, &args),
        "present_document" => tool_present_document(id, &args),
        other => Response::err(id, -32602, format!("Unknown tool: {other}")),
    }
}

// ── Tools ─────────────────────────────────────────────────────────────────────

fn tool_open_file(id: Value, args: &Value) -> Response {
    let raw_path = match args["path"].as_str() {
        Some(p) => p.to_string(),
        None => return Response::err(id, -32602, "`path` is required"),
    };

    let abs = std::fs::canonicalize(&raw_path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(raw_path.clone());

    let mode = args["mode"].as_str();

    // Try IPC first (app already running).
    match ipc_post(
        "/open",
        json!({ "path": abs, "mode": mode }),
    ) {
        Ok(resp) => return tool_result(id, json!({ "opened": abs, "response": resp })),
        Err(_) => {
            // Fall back: launch / bring to front via URL scheme.
        }
    }

    let encoded = urlencoding::encode(&abs);
    let mut url = format!("mdopener://open?path={encoded}");
    if let Some(m) = mode {
        url.push_str(&format!("&mode={m}"));
    }

    match std::process::Command::new("open").arg(&url).status() {
        Ok(s) if s.success() => {
            tool_result(id, json!({ "opened": abs, "method": "url-scheme" }))
        }
        Ok(s) => Response::err(
            id,
            -32000,
            format!("`open` exited with status {}", s.code().unwrap_or(-1)),
        ),
        Err(e) => Response::err(id, -32000, format!("Failed to run `open`: {e}")),
    }
}

fn tool_get_content(id: Value) -> Response {
    match ipc_get("/content") {
        Ok(v) => tool_result(id, v),
        Err(e) => Response::err(id, -32000, app_not_running_msg(&e)),
    }
}

fn tool_set_content(id: Value, args: &Value) -> Response {
    let content = match args["content"].as_str() {
        Some(c) => c.to_string(),
        None => return Response::err(id, -32602, "`content` is required"),
    };
    let save = args["save"].as_bool().unwrap_or(false);

    match ipc_post("/content", json!({ "content": content, "save": save })) {
        Ok(v) => tool_result(id, v),
        Err(e) => Response::err(id, -32000, app_not_running_msg(&e)),
    }
}

fn tool_list_recent(id: Value, args: &Value) -> Response {
    let limit = args["limit"].as_u64().unwrap_or(10);
    match ipc_get(&format!("/recent?limit={limit}")) {
        Ok(v) => tool_result(id, v),
        Err(e) => Response::err(id, -32000, app_not_running_msg(&e)),
    }
}

fn tool_export(id: Value, args: &Value) -> Response {
    let format = match args["format"].as_str() {
        Some(f) => f.to_string(),
        None => return Response::err(id, -32602, "`format` is required"),
    };
    let output_path = args["output_path"].as_str().map(str::to_string);

    match ipc_post(
        "/export",
        json!({ "format": format, "outputPath": output_path }),
    ) {
        Ok(v) => tool_result(id, v),
        Err(e) => Response::err(id, -32000, app_not_running_msg(&e)),
    }
}

// ── Human-review loop ────────────────────────────────────────────────────

/// Register a review with the app, then POLL for the human's verdict in a loop
/// (each poll is a fresh request well within the 5s TCP timeout). Returns the
/// verdict to the agent, or a timeout if no decision arrives in time.
fn tool_request_review(id: Value, args: &Value) -> Response {
    let path = args["path"].as_str().map(|p| {
        std::fs::canonicalize(p)
            .map(|c| c.to_string_lossy().into_owned())
            .unwrap_or_else(|_| p.to_string())
    });
    let content = args["content"].as_str().map(str::to_string);
    let blocking = args["blocking"].as_bool().unwrap_or(true);
    let timeout_ms = args["timeout_ms"].as_u64().unwrap_or(300_000).clamp(5_000, 600_000);

    if path.is_none() && content.is_none() {
        return Response::err(id, -32602, "Either `path` or `content` is required");
    }

    // reviewId generated here: nanosecond timestamp + pid (no uuid crate). Using
    // nanos + the full 32-bit pid makes a collision between two concurrently
    // launched MCP processes effectively impossible.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let review_id = format!("rev_{nanos}_{:08x}", std::process::id());

    let post_body = json!({
        "reviewId": review_id,
        "path": path,
        "content": content,
        "timeoutMs": timeout_ms,
    });
    if let Err(e) = ipc_post("/review", post_body) {
        return Response::err(id, -32000, app_not_running_msg(&e));
    }

    if !blocking {
        return tool_result(id, json!({ "reviewId": review_id, "status": "pending" }));
    }

    let poll = std::time::Duration::from_millis(1_500);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    let endpoint = format!("/review/result?id={review_id}");
    loop {
        // Check the deadline first, then sleep no longer than the time left, so
        // the total wait can't overshoot timeout_ms by a full poll interval.
        let now = std::time::Instant::now();
        if now >= deadline {
            return tool_result(id, json!({
                "verdict": "timeout",
                "reviewId": review_id,
                "message": "No verdict received within the timeout period."
            }));
        }
        std::thread::sleep(poll.min(deadline - now));
        match ipc_get(&endpoint) {
            Err(e) => return Response::err(id, -32000, format!("App unreachable during review: {e}")),
            Ok(resp) => match resp["status"].as_str().unwrap_or("") {
                "pending" => continue,
                "not_found" => return tool_result(id, json!({
                    "verdict": "timeout",
                    "reviewId": review_id,
                    "message": "Review record lost (app may have restarted)."
                })),
                _ => return tool_result(id, json!({
                    "verdict": resp["verdict"],
                    "reviewId": review_id,
                    "comments": resp["comments"],
                })),
            },
        }
    }
}

fn tool_get_annotations(id: Value, args: &Value) -> Response {
    let path = match args["path"].as_str() {
        Some(p) => p,
        None => return Response::err(id, -32602, "`path` is required"),
    };
    let encoded = urlencoding::encode(path);
    match ipc_get(&format!("/annotations?path={encoded}")) {
        Ok(v) => tool_result(id, v),
        Err(e) => Response::err(id, -32000, app_not_running_msg(&e)),
    }
}

// ── Document edit / search / present tools ───────────────────────────────────

fn tool_edit_document(id: Value, args: &Value) -> Response {
    let find = match args["find"].as_str() {
        Some(f) => f.to_string(),
        None => return Response::err(id, -32602, "`find` is required"),
    };
    let replace = match args["replace"].as_str() {
        Some(r) => r.to_string(),
        None => return Response::err(id, -32602, "`replace` is required"),
    };
    let save = args["save"].as_bool().unwrap_or(false);

    let mut body = json!({ "find": find, "replace": replace, "save": save });
    if let Some(p) = args["path"].as_str() {
        body["path"] = json!(p);
    }

    match ipc_post("/edit", body) {
        Ok(v) => {
            // The server reports not-found / not-unique as ok:false so the agent
            // gets the reason as a tool error rather than an opaque HTTP failure.
            if v["ok"].as_bool() == Some(false) {
                let msg = v["error"].as_str().unwrap_or("Edit could not be applied.");
                return tool_error(id, msg.to_string());
            }
            tool_result(id, v)
        }
        Err(e) => Response::err(id, -32000, app_not_running_msg(&e)),
    }
}

fn tool_replace_document(id: Value, args: &Value) -> Response {
    let content = match args["content"].as_str() {
        Some(c) => c.to_string(),
        None => return Response::err(id, -32602, "`content` is required"),
    };
    let save = args["save"].as_bool().unwrap_or(false);
    match ipc_post("/content", json!({ "content": content, "save": save })) {
        Ok(v) => tool_result(id, v),
        Err(e) => Response::err(id, -32000, app_not_running_msg(&e)),
    }
}

fn tool_search_vault(id: Value, args: &Value) -> Response {
    let query = match args["query"].as_str() {
        Some(q) => q.to_string(),
        None => return Response::err(id, -32602, "`query` is required"),
    };
    let limit = args["limit"].as_u64().unwrap_or(50);
    let encoded = urlencoding::encode(&query);
    match ipc_get(&format!("/search?q={encoded}&limit={limit}")) {
        Ok(v) => tool_result(id, v),
        Err(e) => Response::err(id, -32000, app_not_running_msg(&e)),
    }
}

fn tool_present_document(id: Value, args: &Value) -> Response {
    let path = args["path"].as_str().map(|p| {
        std::fs::canonicalize(p)
            .map(|c| c.to_string_lossy().into_owned())
            .unwrap_or_else(|_| p.to_string())
    });
    match ipc_post("/present", json!({ "path": path })) {
        Ok(v) => tool_result(id, v),
        Err(e) => Response::err(id, -32000, app_not_running_msg(&e)),
    }
}

// ── Resources ────────────────────────────────────────────────────────────────

fn handle_resources_list(id: Value) -> Response {
    let mut resources = vec![json!({
        "uri": "mdopener://current",
        "name": "Current document",
        "description": "The document currently open in Ashlr MD.",
        "mimeType": "text/markdown"
    })];

    // Add the vault's files (best-effort — empty if the app isn't running).
    if let Ok(v) = ipc_get("/vault") {
        if let Some(files) = v["files"].as_array() {
            for f in files {
                if let Some(p) = f["path"].as_str() {
                    resources.push(json!({
                        "uri": format!("file://{p}"),
                        "name": f["name"].as_str().unwrap_or(p),
                        "mimeType": "text/markdown"
                    }));
                }
            }
        }
    }

    Response::ok(id, json!({ "resources": resources }))
}

fn handle_resource_read(id: Value, uri: &str) -> Response {
    if uri == "mdopener://current" {
        return match ipc_get("/content") {
            Ok(v) => {
                let text = v["content"].as_str().unwrap_or("").to_string();
                Response::ok(id, json!({
                    "contents": [{ "uri": uri, "mimeType": "text/markdown", "text": text }]
                }))
            }
            Err(e) => Response::err(id, -32000, app_not_running_msg(&e)),
        };
    }
    if let Some(p) = uri.strip_prefix("file://") {
        // Only read files the server actually advertised in resources/list (the
        // vault + recents). This keeps the resource channel honest and prevents
        // it being used as an arbitrary-filesystem read primitive.
        if !is_advertised_path(p) {
            return Response::err(id, -32002, format!("Resource not in vault: {uri}"));
        }
        return match std::fs::read_to_string(p) {
            Ok(text) => Response::ok(id, json!({
                "contents": [{ "uri": uri, "mimeType": "text/markdown", "text": text }]
            })),
            // -32002 = "Resource not found" in the MCP spec.
            Err(e) => Response::err(id, -32002, format!("Cannot read {p}: {e}")),
        };
    }
    Response::err(id, -32602, format!("Unknown resource URI: {uri}"))
}

/// True if `path` is one of the files the app currently advertises as part of
/// the vault or recents (queried live). Used to scope `resources/read`.
fn is_advertised_path(path: &str) -> bool {
    let Ok(v) = ipc_get("/vault") else {
        return false;
    };
    let in_files = v["files"]
        .as_array()
        .map(|a| a.iter().any(|f| f["path"].as_str() == Some(path)))
        .unwrap_or(false);
    let in_recents = v["recents"]
        .as_array()
        .map(|a| a.iter().any(|r| r.as_str() == Some(path)))
        .unwrap_or(false);
    in_files || in_recents
}

// ── Prompts ──────────────────────────────────────────────────────────────────

fn prompts_list() -> Value {
    json!([
        { "name": "summarize", "description": "Summarize the current document into key points." },
        { "name": "review_plan", "description": "Review the current document as a plan and flag risks, gaps, and unclear steps." },
        { "name": "improve_writing", "description": "Tighten the prose of the current document without changing its meaning." }
    ])
}

fn handle_prompt_get(id: Value, name: &str) -> Response {
    let instruction = match name {
        "summarize" => {
            "Summarize the following Markdown document into a short bulleted list of its key points:"
        }
        "review_plan" => {
            "Review the following Markdown document as an implementation plan. Identify risks, missing steps, and anything ambiguous:"
        }
        "improve_writing" => {
            "Improve the writing of the following Markdown document — tighten prose and fix grammar without changing its meaning or structure:"
        }
        other => return Response::err(id, -32602, format!("Unknown prompt: {other}")),
    };
    // Embed the live document so the resulting prompt is self-contained.
    let content = ipc_get("/content")
        .ok()
        .and_then(|v| v["content"].as_str().map(str::to_string))
        .unwrap_or_default();
    let text = format!("{instruction}\n\n---\n\n{content}");

    Response::ok(id, json!({
        "description": format!("Apply the '{name}' prompt to the current Ashlr MD document"),
        "messages": [{ "role": "user", "content": { "type": "text", "text": text } }]
    }))
}

// ── IPC helpers ────────────────────────────────────────────────────────────────
/// Read the port written by the running app.
fn read_ipc_port() -> Result<u16, String> {
    let path = dirs::home_dir()
        .map(|h| h.join(".mdopener").join("ipc-port"))
        .ok_or("Cannot determine home directory")?;

    let content = std::fs::read_to_string(&path)
        .map_err(|_| "~/.mdopener/ipc-port not found — is Ashlr MD running?".to_string())?;

    content
        .trim()
        .parse::<u16>()
        .map_err(|e| format!("Invalid port in ipc-port file: {e}"))
}

/// Read the per-session auth token written by the running app.
fn read_ipc_token() -> Result<String, String> {
    let path = dirs::home_dir()
        .map(|h| h.join(".mdopener").join("ipc-token"))
        .ok_or("Cannot determine home directory")?;
    std::fs::read_to_string(&path)
        .map_err(|_| "~/.mdopener/ipc-token not found — is Ashlr MD running?".to_string())
        .and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() {
                // File exists but is empty — the app is mid-startup or wrote a
                // truncated token. Fail loudly rather than send an empty bearer.
                Err("~/.mdopener/ipc-token is empty — is Ashlr MD finished starting?".to_string())
            } else {
                Ok(t)
            }
        })
}

/// Make a GET request to the IPC server and return the parsed JSON body.
fn ipc_get(path: &str) -> Result<Value, String> {
    let port = read_ipc_port()?;
    let token = read_ipc_token()?;
    let url = format!("http://127.0.0.1:{port}{path}");
    http_get(&url, &token)
}

/// Make a POST request with a JSON body and return the parsed JSON response.
fn ipc_post(path: &str, body: Value) -> Result<Value, String> {
    let port = read_ipc_port()?;
    let token = read_ipc_token()?;
    let url = format!("http://127.0.0.1:{port}{path}");
    http_post(&url, &body, &token)
}

// Minimal HTTP client using only std (no reqwest/ureq to keep the binary tiny).
fn http_get(url: &str, token: &str) -> Result<Value, String> {
    let (host, port, path) = parse_url(url)?;
    let request = format!(
        "GET {path} HTTP/1.0\r\nHost: {host}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    );
    let response_body = tcp_roundtrip(&host, port, request.as_bytes())?;
    parse_http_body(&response_body)
}

fn http_post(url: &str, body: &Value, token: &str) -> Result<Value, String> {
    let (host, port, path) = parse_url(url)?;
    let body_str = body.to_string();
    let request = format!(
        "POST {path} HTTP/1.0\r\nHost: {host}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body_str}",
        body_str.len()
    );
    let response_body = tcp_roundtrip(&host, port, request.as_bytes())?;
    parse_http_body(&response_body)
}

fn parse_url(url: &str) -> Result<(String, u16, String), String> {
    // Expect http://host:port/path
    let rest = url
        .strip_prefix("http://")
        .ok_or("Only http:// supported")?;
    let (authority, path) = rest
        .split_once('/')
        .map(|(a, p)| (a, format!("/{p}")))
        .unwrap_or((rest, "/".to_string()));
    let (host, port_str) = authority
        .split_once(':')
        .ok_or("Expected host:port")?;
    let port = port_str
        .parse::<u16>()
        .map_err(|e| format!("Invalid port: {e}"))?;
    Ok((host.to_string(), port, path))
}

fn tcp_roundtrip(host: &str, port: u16, request: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::{Read as _, Write as _};
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = format!("{host}:{port}");
    let mut stream = TcpStream::connect(&addr)
        .map_err(|e| format!("Could not connect to IPC server at {addr}: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .ok();
    stream
        .write_all(request)
        .map_err(|e| format!("IPC write error: {e}"))?;

    let mut buf = Vec::new();
    stream
        .read_to_end(&mut buf)
        .map_err(|e| format!("IPC read error: {e}"))?;
    Ok(buf)
}

fn parse_http_body(raw: &[u8]) -> Result<Value, String> {
    // Split on the blank line that separates HTTP headers from body.
    let sep = b"\r\n\r\n";
    let body_start = raw
        .windows(sep.len())
        .position(|w| w == sep)
        .map(|p| p + sep.len())
        .unwrap_or(0);

    // Surface HTTP error statuses (e.g. 401 auth failure) as Err rather than
    // letting an {"error":…} body bubble up as a successful parse.
    if let Ok(head) = std::str::from_utf8(&raw[..body_start]) {
        if let Some(code) = head
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|s| s.parse::<u16>().ok())
        {
            if code == 401 {
                return Err(
                    "IPC auth failed: token mismatch or missing ~/.mdopener/ipc-token".to_string(),
                );
            }
            if code >= 400 {
                return Err(format!("IPC server returned HTTP {code}"));
            }
        }
    }

    let body = &raw[body_start..];
    serde_json::from_slice(body).map_err(|e| format!("IPC JSON parse error: {e}"))
}

// ── Response helpers ──────────────────────────────────────────────────────────

/// Wrap a value in the MCP `content` envelope.
fn tool_result(id: Value, value: Value) -> Response {
    Response::ok(
        id,
        json!({
            "content": [{ "type": "text", "text": value.to_string() }],
            "isError": false
        }),
    )
}

/// A tool-level error (the call reached the app but the operation was rejected,
/// e.g. an ambiguous edit). Distinct from a JSON-RPC transport error.
fn tool_error(id: Value, message: String) -> Response {
    Response::ok(
        id,
        json!({
            "content": [{ "type": "text", "text": message }],
            "isError": true
        }),
    )
}

fn app_not_running_msg(err: &str) -> String {
    if err.contains("ipc-port") || err.contains("not found") || err.contains("connect") {
        format!(
            "Ashlr MD does not appear to be running ({}). \
             Launch it first, or use open_file which can start it automatically.",
            err
        )
    } else {
        err.to_string()
    }
}
