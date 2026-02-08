import { Command } from "@tauri-apps/plugin-shell";
import type { ChatModelAdapter } from "@assistant-ui/react";

/**
 * Event shape emitted by `claude --output-format stream-json`.
 *
 * The CLI emits newline-delimited JSON with these event types:
 * - `system`    – session metadata (session_id)
 * - `assistant` – incremental content blocks (full text per block, not deltas)
 * - `result`    – final complete response text
 */
interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  message?: { content: Array<{ type: string; text?: string }> };
  result?: string;
  cost_usd?: number;
  session_id?: string;
}

/** Tracks the Claude CLI session for conversation continuity via --resume. */
let sessionId: string | null = null;

/** Whether we've already run the one-time PATH diagnostic. */
let diagRan = false;

/**
 * Runs a one-time diagnostic to log the Tauri process PATH,
 * locate the `claude` binary, and verify it responds to --version.
 */
async function runDiagnostics(): Promise<void> {
  if (diagRan) return;
  diagRan = true;

  console.log("[claude-diag] Running environment diagnostics...");

  // 1. Print PATH and locate claude
  const pathCmd = Command.create("sh", [
    "-c",
    "echo PATH=$PATH && echo '---' && which claude 2>&1 && echo '---' && claude --version 2>&1",
  ]);

  pathCmd.stdout.on("data", (line: string) => {
    console.log("[claude-diag] stdout:", line);
  });
  pathCmd.stderr.on("data", (line: string) => {
    console.warn("[claude-diag] stderr:", line);
  });
  pathCmd.on("close", (data) => {
    console.log("[claude-diag] closed:", JSON.stringify(data));
  });
  pathCmd.on("error", (err: string) => {
    console.error("[claude-diag] error:", err);
  });

  try {
    await pathCmd.spawn();
  } catch (err) {
    console.error("[claude-diag] spawn failed:", err);
  }
}

/**
 * Resets the stored Claude CLI session ID.
 * Call this when starting a fresh conversation thread.
 */
export function resetClaudeSession(): void {
  sessionId = null;
}

/**
 * Extracts the text content from the last user message in assistant-ui's
 * ThreadMessage format, concatenating all text parts.
 */
function extractUserPrompt(
  messages: Parameters<ChatModelAdapter["run"]>[0]["messages"],
): string {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) return "";

  return lastUserMsg.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/**
 * Item type for the async bridge queue between Tauri's event-based
 * stdout and the generator's pull-based consumption.
 */
type QueueItem = { text: string } | { done: true } | { error: Error };

/**
 * Creates a simple push/pull async queue.
 * The producer (stdout event handler) pushes items,
 * the consumer (async generator) pulls them.
 */
function createAsyncQueue() {
  const buffer: QueueItem[] = [];
  let waiting: ((item: QueueItem) => void) | null = null;

  const push = (item: QueueItem) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(item);
    } else {
      buffer.push(item);
    }
  };

  const pull = (): Promise<QueueItem> => {
    if (buffer.length > 0) {
      return Promise.resolve(buffer.shift()!);
    }
    return new Promise((resolve) => {
      waiting = resolve;
    });
  };

  return { push, pull };
}

/**
 * ChatModelAdapter that bridges the Claude CLI (via Tauri shell plugin)
 * into assistant-ui's LocalRuntime streaming interface.
 *
 * - Spawns `claude -p <prompt> --output-format stream-json`
 * - Uses `--resume <session_id>` for conversation continuity
 * - Parses newline-delimited JSON events from stdout
 * - Yields incremental text content to the runtime
 * - Supports cancellation via AbortSignal → child.kill()
 */
export const claudeAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    // First invocation: dump PATH, which claude, and claude --version
    await runDiagnostics();

    const prompt = extractUserPrompt(messages);
    if (!prompt.trim()) return;

    // Spawn through `sh -c` — Tauri's direct process spawning (no shell/PTY)
    // causes Claude CLI to hang silently. Running via shell resolves this.
    const shellEscape = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    const cmdParts = ["claude", "-p", shellEscape(prompt), "--output-format", "stream-json", "--verbose"];
    if (sessionId) {
      cmdParts.push("--resume", shellEscape(sessionId));
    }
    // H1a fix: redirect stdin from /dev/null to prevent Claude CLI from
    // blocking on an open stdin pipe (Tauri shell plugin keeps stdin open).
    const shellCmd = cmdParts.join(" ") + " < /dev/null";

    console.log("[claude-adapter] spawning:", shellCmd);
    const command = Command.create("sh", ["-c", shellCmd]);
    const { push, pull } = createAsyncQueue();

    // --- Wire up stdout event parsing (mirrors useClaude.ts logic) ---
    command.stdout.on("data", (line: string) => {
      console.log("[claude-adapter] stdout:", line);
      if (!line.trim()) return;
      try {
        const event: ClaudeStreamEvent = JSON.parse(line);

        if (event.type === "system" && event.session_id) {
          sessionId = event.session_id;
        } else if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              push({ text: block.text });
            }
          }
        } else if (event.type === "result" && event.result) {
          push({ text: event.result });
        }
      } catch {
        // Skip unparseable lines (e.g. partial JSON)
      }
    });

    // Capture stderr — Claude CLI may log errors/prompts here
    command.stderr.on("data", (line: string) => {
      console.warn("[claude-adapter] stderr:", line);
    });

    command.on("close", (data) => {
      console.log("[claude-adapter] process closed:", JSON.stringify(data));
      push({ done: true });
    });
    command.on("error", (err: string) => {
      console.error("[claude-adapter] process error:", err);
      push({ error: new Error(`Claude CLI error: ${err}`) });
    });

    // Spawn the process
    let child;
    try {
      child = await command.spawn();
      console.log("[claude-adapter] spawned pid:", child.pid);
    } catch (err) {
      console.error("[claude-adapter] spawn failed:", err);
      throw err;
    }

    // Handle user cancellation (cancel button / Escape key)
    const onAbort = () => {
      child.kill();
      push({ done: true });
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });

    try {
      // Pull from the queue and yield to LocalRuntime
      while (true) {
        const item = await pull();
        if ("done" in item) break;
        if ("error" in item) throw item.error;

        yield {
          content: [{ type: "text" as const, text: item.text }],
        };
      }
    } finally {
      abortSignal.removeEventListener("abort", onAbort);
    }
  },
};
