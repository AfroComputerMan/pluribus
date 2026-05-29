# Pi's `--mode rpc` protocol is `type`-framed (not JSON-RPC), verified against the binary

**Status:** accepted (2026-05-30)

## Context

Issues #17–#21 and ADR 0001 originally assumed Pluribus could reuse the `codex/service.rs`
JSON-RPC stdio layer "verbatim" to drive Pi. We verified the real protocol against the installed
binary — `@mariozechner/pi-coding-agent` **v0.67.68** — via `--help`, its bundled `.d.ts` types
(`dist/modes/rpc/rpc-types.d.ts`, `pi-agent-core/dist/types.d.ts`), and a live `--mode rpc` run on
OpenRouter / `deepseek/deepseek-v4-flash`. This ADR records the verified facts so they are not
re-assumed. Full evidence: `docs/plans/2026-05-30-pi-poc-gap-report.md` §7.

## Decision / verified protocol

- **Launch:** `pi --mode rpc` (`--mode <text|json|rpc>`). `--rpc` is **not** a flag. Provider-agnostic:
  `--provider <name> --model <provider/id> --api-key <key>` (key also resolved from env, e.g.
  `OPENROUTER_API_KEY`). Pi has **no dotenv layer** — the spawner injects the key into Pi's child env.
- **Framing:** strict **LF-only** JSONL. Split stdout on `\n` only (payloads may contain U+2028/U+2029);
  do **not** use a readline that splits on other separators.
- **Not JSON-RPC.** Commands are `{ "type": "<cmd>", "id?": string, ... }`. Replies are
  `{ "type":"response", "command":"<cmd>", "success":bool, "data"?|"error"? }`. There is **no
  `initialize` handshake** and **no `ready` event** — probe readiness with `get_state`. The `id` is
  echoed on every response and the ack arrives **before** the event stream, so correlate by `id`.
- **Events (`AgentEvent`, emitted as their own JSONL lines):** `agent_start` → `turn_start` →
  `message_start`/`message_end` (the **user prompt is echoed** as a `role:"user"` message — skip it) →
  assistant `message_start` → N×`message_update` → `message_end` → `turn_end { message, toolResults }` →
  **`agent_end { messages }` is the terminator** (loop until `agent_end`, not the first `turn_end`).
- **Streaming deltas live in `message_update.assistantMessageEvent`**, a typed sub-stream:
  `thinking_start|thinking_delta|thinking_end` then `text_start|text_delta|text_end`, each with
  `contentIndex`, `delta` (increment) and `partial` (accumulator). Map `text_delta`→visible output,
  `thinking_delta`→reasoning UI. **Never** read `message.content` for deltas.
- **Tools:** `tool_execution_start { toolCallId, toolName, args }` →
  `tool_execution_end { toolCallId, toolName, result, isError }`, plus a `role:"toolResult"` message.
- **Control:** `steer` is **queued** (a `queue_update` event confirms it) and applied at the next
  turn/tool boundary — **not** a mid-token interrupt (verified: an in-flight essay kept streaming).
  `abort` halts **promptly** (~6 ms to `agent_end`, then `{command:"abort",success:true}`). Closing
  stdin exits Pi cleanly (`code 0`).
- **`extension_ui_request` / `extension_ui_response` is a real round-trip** (`confirm`/`select`/`input`/
  `editor`/`notify`/…). Native tools never use it, but Skills/Extensions can — the bridge **must** answer
  or the agent blocks. (See [ADR 0002](0002-sandbox-as-safety-boundary.md).)
- **Reference driver:** Pi ships an official TypeScript `RpcClient`
  (`dist/modes/rpc/rpc-client.{js,d.ts}`); the Rust `PiService` should mirror its command/event handling.

## Consequences

- The `codex/service.rs` **process pattern** (Tokio long-lived child, stdout reader, stdin writer,
  supervisor) is reused; its JSON-RPC **dispatch/correlation/handshake** layer is rewritten for the
  `type`-framed protocol above. A `PiIo` seam should abstract host (`ChildStdout`) vs container
  (`docker exec` `LogOutput` stream) so #18 swaps the I/O source without touching the core.
- For the host-only POC stage (#17) native tools run on the host; the sandbox boundary (#18, ADR 0002)
  is what contains them.
