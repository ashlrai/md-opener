// mdopener-afm — Apple Foundation Models sidecar for MD Opener
//
// Protocol (JSON-Lines on stdin/stdout):
//
//   STARTUP:
//     If FoundationModels is unavailable (OS < 26, Apple Intelligence off, model
//     not downloaded), prints ONE JSON line and exits 0:
//       {"available":false,"reason":"<human-readable>"}
//
//     If available, prints ONE JSON line and enters the request loop:
//       {"available":true,"model":"Apple Foundation Models"}
//
//   REQUEST (one JSON line per request, written to sidecar's stdin):
//     {"id":"<req-id>","messages":[{"role":"system"|"user"|"assistant","content":"..."}],"stream":true}
//
//   RESPONSE (one or more JSON lines per request, written to stdout):
//     {"id":"<req-id>","delta":"<token-chunk>"}  — zero or more streaming deltas
//     {"id":"<req-id>","done":true}              — stream finished successfully
//     {"id":"<req-id>","error":"<message>"}      — hard error (replaces done)
//
// The sidecar is long-lived; Rust spawns it once and pipes requests over stdin.
// One request is processed at a time (Rust serialises calls via a Mutex).

import Foundation

// FoundationModels is macOS 26+. We import at the top level (Swift doesn't
// allow imports inside functions) and guard every *use* with
// @available(macOS 26, *) so the binary compiles against the macOS 15
// deployment target and degrades gracefully at runtime on older systems.
#if canImport(FoundationModels)
import FoundationModels
#endif

// ---------------------------------------------------------------------------
// JSON output helpers
// ---------------------------------------------------------------------------

/// Write a JSON object as a single newline-terminated line to stdout.
/// Flushes stdout immediately so Rust's BufReader sees it without blocking.
func emitJSON(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
          var line = String(data: data, encoding: .utf8) else { return }
    if !line.hasSuffix("\n") { line += "\n" }
    print(line, terminator: "")
    fflush(stdout)
}

func exitUnavailable(reason: String) -> Never {
    emitJSON(["available": false, "reason": reason])
    exit(0)
}

// ---------------------------------------------------------------------------
// Wire types — decoded from stdin
// ---------------------------------------------------------------------------

struct AFMMessage: Decodable {
    let role: String
    let content: String
}

struct AFMRequest: Decodable {
    let id: String
    let messages: [AFMMessage]
    let stream: Bool?   // always treated as true; kept for forward compat
}

// ---------------------------------------------------------------------------
// Runtime OS guard
// ---------------------------------------------------------------------------

// We use `guard #available` at top level so the compiler treats everything
// below as implicitly @available(macOS 26, *) within the guarded branches.
// The `else` branch exits before any FoundationModels symbol is touched.
guard #available(macOS 26.0, *) else {
    exitUnavailable(reason: "FoundationModels requires macOS 26.0 or later (this system is older)")
}

// ---------------------------------------------------------------------------
// Availability check + dispatch
// ---------------------------------------------------------------------------

@available(macOS 26.0, *)
func checkAvailabilityAndRun() {
    switch SystemLanguageModel.default.availability {
    case .available:
        emitJSON(["available": true, "model": "Apple Foundation Models"])
        // Enter the async request loop, blocking the main thread until EOF.
        let sema = DispatchSemaphore(value: 0)
        Task {
            await requestLoop()
            sema.signal()
        }
        sema.wait()

    case .unavailable(let reason):
        let msg: String
        switch reason {
        case .deviceNotEligible:
            msg = "This device is not eligible for Apple Intelligence"
        case .appleIntelligenceNotEnabled:
            msg = "Apple Intelligence is not enabled — open System Settings → Apple Intelligence & Siri"
        case .modelNotReady:
            msg = "Apple Intelligence model is not yet downloaded or ready"
        @unknown default:
            msg = "Apple Foundation Models unavailable (reason: \(reason))"
        }
        exitUnavailable(reason: msg)
    }
}

// ---------------------------------------------------------------------------
// Request loop — read newline-terminated JSON from stdin
// ---------------------------------------------------------------------------

@available(macOS 26.0, *)
func requestLoop() async {
    let stdin = FileHandle.standardInput
    var leftover = Data()

    while true {
        // readData(ofLength:) blocks until bytes are available or EOF.
        // Empty return == EOF == parent process exited.
        let chunk = stdin.readData(ofLength: 4096)
        guard !chunk.isEmpty else { break }
        leftover.append(chunk)

        // Process all complete newline-terminated lines in the buffer.
        while let nlIdx = leftover.firstIndex(of: 0x0A /* '\n' */) {
            let lineData = leftover[leftover.startIndex..<nlIdx]
            // Advance past the newline.
            leftover = (nlIdx + 1 < leftover.endIndex)
                ? Data(leftover[(nlIdx + 1)...])
                : Data()

            guard !lineData.isEmpty else { continue }

            guard let req = try? JSONDecoder().decode(AFMRequest.self, from: lineData) else {
                // Malformed JSON — no request id available to error-reply; skip.
                continue
            }

            await handleRequest(req)
        }
    }
}

// ---------------------------------------------------------------------------
// Per-request handler
// ---------------------------------------------------------------------------

@available(macOS 26.0, *)
func handleRequest(_ req: AFMRequest) async {
    // Separate system instructions from the conversation turns.
    let systemText = req.messages
        .filter { $0.role == "system" }
        .map(\.content)
        .joined(separator: "\n\n")

    let turns = req.messages.filter { $0.role != "system" }

    guard !turns.isEmpty else {
        emitJSON(["id": req.id, "error": "No user or assistant messages in request"])
        return
    }

    // Build the user-facing prompt string.
    // For a single user turn we pass it directly (cleanest for the model).
    // For multi-turn history we reconstruct with role labels so the model
    // understands context, matching the pattern used by ai.rs for ollama/anthropic.
    let promptText: String
    if turns.count == 1 && turns[0].role == "user" {
        promptText = turns[0].content
    } else {
        promptText = turns.map { m in
            let label = m.role == "assistant" ? "Assistant" : "User"
            return "\(label): \(m.content)"
        }.joined(separator: "\n\n")
    }

    // Create a LanguageModelSession.
    //
    // Confirmed symbols (from arm64e-apple-macos.swiftinterface, lines 339/343):
    //   convenience init(model: SystemLanguageModel = .default,
    //                    tools: [any Tool] = [],
    //                    instructions: String? = nil)   <- @_disfavoredOverload
    //
    // We use the plain String? overload (not the @InstructionsBuilder one)
    // for simplicity. Pass nil when there are no system instructions so the
    // model uses its default behaviour.
    let session: LanguageModelSession
    if systemText.isEmpty {
        session = LanguageModelSession(model: .default)
    } else {
        session = LanguageModelSession(model: .default, instructions: systemText)
    }

    // Stream the response.
    //
    // Confirmed symbol (swiftinterface line 559):
    //   @_disfavoredOverload
    //   func streamResponse(to prompt: String, options: GenerationOptions = ...)
    //     -> ResponseStream<String>
    //
    // ResponseStream<String> is an AsyncSequence whose elements are
    // Snapshot values.  Snapshot.content: String.PartiallyGenerated.
    // For String, PartiallyGenerated == String (swiftinterface line 69),
    // so snapshot.content is the CUMULATIVE text generated so far.
    //
    // We diff successive snapshot lengths to produce per-chunk delta
    // strings matching the "ai://delta" event format used by ai.rs.
    do {
        let responseStream = session.streamResponse(to: promptText)
        var previousLength = 0

        for try await snapshot in responseStream {
            let fullText: String = snapshot.content
            guard fullText.count > previousLength else { continue }
            let startIdx = fullText.index(fullText.startIndex, offsetBy: previousLength)
            let delta = String(fullText[startIdx...])
            previousLength = fullText.count
            if !delta.isEmpty {
                emitJSON(["id": req.id, "delta": delta])
            }
        }

        emitJSON(["id": req.id, "done": true])

    } catch let genErr as LanguageModelSession.GenerationError {
        // Confirmed error cases (swiftinterface lines 440-448):
        let errMsg: String
        switch genErr {
        case .exceededContextWindowSize:
            errMsg = "Apple Foundation Models: context window exceeded"
        case .assetsUnavailable:
            errMsg = "Apple Foundation Models: assets unavailable (model may be unloading)"
        case .guardrailViolation:
            errMsg = "Apple Foundation Models: request blocked by safety guardrails"
        case .unsupportedLanguageOrLocale:
            errMsg = "Apple Foundation Models: unsupported language or locale"
        case .unsupportedGuide:
            errMsg = "Apple Foundation Models: unsupported generation guide"
        case .decodingFailure:
            errMsg = "Apple Foundation Models: structured response decoding failure"
        case .rateLimited:
            errMsg = "Apple Foundation Models: rate limited — too many on-device requests"
        case .concurrentRequests:
            errMsg = "Apple Foundation Models: concurrent request limit reached"
        case .refusal(let refusal, _):
            errMsg = "Apple Foundation Models: model refused — \(refusal)"
        @unknown default:
            errMsg = "Apple Foundation Models: unknown generation error"
        }
        emitJSON(["id": req.id, "error": errMsg])

    } catch {
        emitJSON(["id": req.id, "error": "Apple Foundation Models error: \(error.localizedDescription)"])
    }
}

// ---------------------------------------------------------------------------
// Kick off (we're already past the #available guard above)
// ---------------------------------------------------------------------------

if #available(macOS 26.0, *) {
    checkAvailabilityAndRun()
} else {
    exitUnavailable(reason: "FoundationModels requires macOS 26.0 or later")
}
