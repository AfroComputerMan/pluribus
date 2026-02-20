/**
 * Agent SDK Bridge — Bun sidecar
 *
 * Reads NDJSON query messages from stdin, runs them through
 * @anthropic-ai/claude-agent-sdk, and writes NDJSON SDKMessage
 * events to stdout.
 *
 * Protocol (one JSON object per line):
 *
 * stdin (Frontend -> Sidecar):
 *   { "type": "query", "id": "<uuid>", "prompt": "...", "sessionId"?: "...", "model"?: "...", "cwd": "/path" }
 *   { "type": "interrupt", "queryId": "<uuid>" }
 *   { "type": "ping" }
 *
 * stdout (Sidecar -> Frontend):
 *   { "type": "pong" }
 *   { "type": "message", "queryId": "<uuid>", "message": <SDKMessage> }
 *   { "type": "done",    "queryId": "<uuid>", "sessionId": "...", "costUsd": 0.0 }
 *   { "type": "error",   "queryId": "<uuid>", "error": "..." }
 */
import { createInterface } from "node:readline";
import { query } from "@anthropic-ai/claude-agent-sdk";

// Resolve the claude CLI path once at startup.
// Bun.which() searches PATH from the real environment, bypassing the
// compiled binary's virtual FS — necessary because the SDK auto-detection
// fails when running inside a bun --compile bundle (it sees /$bunfs/root/...).
const claudePath = Bun.which("claude");
if (!claudePath) {
  process.stderr.write(
    "[agent-sdk-bridge] ERROR: 'claude' not found in PATH. Make sure Claude Code is installed.\n"
  );
  process.exit(1);
}
process.stderr.write(`[agent-sdk-bridge] claude path: ${claudePath}\n`);

// Map of active queryId -> AbortController for interrupt support
const activeAborts = new Map<string, AbortController>();

/** Write a JSON message to stdout, one object per line. */
function send(msg: object): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/** Handle a single query: run the SDK generator, stream results. */
async function handleQuery(params: {
  id: string;
  prompt: string;
  sessionId?: string;
  model?: string;
  cwd?: string;
  maxTurns?: number;
}): Promise<void> {
  const { id, prompt, sessionId, model, cwd, maxTurns } = params;
  const abortController = new AbortController();
  activeAborts.set(id, abortController);

  let finalSessionId: string | undefined = sessionId;
  let totalCostUsd = 0;

  try {
    const sdkOptions: Record<string, unknown> = {
      abortController,
      pathToClaudeCodeExecutable: claudePath,
      ...(sessionId ? { resume: sessionId } : {}),
      ...(model ? { model } : {}),
      ...(cwd ? { cwd } : {}),
      ...(maxTurns != null ? { maxTurns } : {}),
    };

    for await (const message of query({ prompt, options: sdkOptions as never })) {
      // Forward every SDK message to the frontend as a "message" event
      send({ type: "message", queryId: id, message });

      // Track session ID and cost from system/result messages
      if (
        "session_id" in message &&
        typeof message.session_id === "string" &&
        message.session_id
      ) {
        finalSessionId = message.session_id;
      }
      if (message.type === "result" && "total_cost_usd" in message) {
        totalCostUsd = (message as { total_cost_usd?: number }).total_cost_usd ?? 0;
      }
    }

    send({
      type: "done",
      queryId: id,
      sessionId: finalSessionId ?? "",
      costUsd: totalCostUsd,
    });
  } catch (err) {
    // AbortError from interrupts is expected -- still send done so the
    // frontend doesn't hang waiting for it.
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("aborted"));

    if (isAbort) {
      send({
        type: "done",
        queryId: id,
        sessionId: finalSessionId ?? "",
        costUsd: totalCostUsd,
      });
    } else {
      send({
        type: "error",
        queryId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    activeAborts.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Main: read stdin line-by-line, dispatch messages
// ---------------------------------------------------------------------------

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg: { type: string; [key: string]: unknown };
  try {
    msg = JSON.parse(trimmed) as typeof msg;
  } catch {
    // Ignore unparseable lines
    return;
  }

  if (msg.type === "ping") {
    send({ type: "pong" });
    return;
  }

  if (msg.type === "interrupt") {
    const queryId = msg.queryId as string | undefined;
    if (queryId) {
      activeAborts.get(queryId)?.abort();
    }
    return;
  }

  if (msg.type === "query") {
    // Fire-and-forget -- the async generator runs independently
    handleQuery({
      id: msg.id as string,
      prompt: msg.prompt as string,
      sessionId: msg.sessionId as string | undefined,
      model: msg.model as string | undefined,
      cwd: msg.cwd as string | undefined,
      maxTurns: msg.maxTurns as number | undefined,
    }).catch((err: unknown) => {
      process.stderr.write(
        `[agent-sdk-bridge] unhandled error in handleQuery: ${String(err)}\n`
      );
    });
    return;
  }
});

// Keep the process alive -- readline keeps stdin open, but be explicit.
process.stdin.resume();

// Log startup to stderr (doesn't interfere with stdout NDJSON protocol)
process.stderr.write("[agent-sdk-bridge] ready\n");
