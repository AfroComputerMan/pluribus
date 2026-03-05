/**
 * OrchestratedAdapter — the single ChatModelAdapter for the entire app.
 *
 * Replaces router-adapter.ts. Routes each run() call to the correct
 * AgentProvider based on the thread's model selection, using the
 * ProviderRegistry for O(1) model-to-provider lookups.
 */
import { homeDir } from "@tauri-apps/api/path";
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import { toast } from "sonner";

import type { ProviderRegistry } from "@/lib/providers/provider-registry";
import type { AgentProcessManager } from "@/lib/orchestration/agent-process-manager";
import type { RunContext } from "@/lib/providers/types";
import { extractUserPrompt } from "@/lib/providers/shared";
import { getCodexPid } from "@/lib/providers/codex-provider";
import { db } from "@/lib/db";
import { resolveModel, resolveEffort } from "@/lib/models";
import { useThreadStatusStore } from "@/lib/thread-status-store";

/**
 * Create the orchestrated adapter that wraps the provider registry.
 *
 * This is the only ChatModelAdapter the app needs. It:
 * 1. Reads thread config (model, effort, cwd) from SQLite
 * 2. Resolves the correct provider via the registry
 * 3. Manages thread status (running/idle/error)
 * 4. Tracks PIDs via the process manager
 * 5. Shows crash toasts on errors
 */
export function createOrchestratedAdapter(
  registry: ProviderRegistry,
  processManager: AgentProcessManager,
): ChatModelAdapter {
  return {
    async *run(options): AsyncGenerator<ChatModelRunResult, void> {
      // 1. Extract thread ID
      const threadId =
        (options as { unstable_threadId?: string }).unstable_threadId?.trim() ??
        "__global__";

      // 2. Load thread config from SQLite
      const threadRow = await db.threads.get(threadId);

      // 3. Resolve model and effort
      const model = resolveModel(threadRow?.model ?? null);
      const effort = resolveEffort(threadRow?.effort ?? null);

      // 4. Select provider
      const provider = registry.getProviderForModel(model);

      // 5. Extract prompt
      const prompt = extractUserPrompt(options.messages);
      if (!prompt.trim()) return;

      // 6. Resolve session
      const sessionRow = await db.sessions.get(threadId);
      const sessionId = sessionRow?.session_id ?? null;

      // 7. Resolve cwd
      const cwd = threadRow?.cwd ?? (await homeDir());

      // 8. Get title for status display
      const title = threadRow?.title ?? undefined;

      // 9. Set status to running
      const { setStatus } = useThreadStatusStore.getState();
      setStatus(threadId, "running", title);

      // 10. Build RunContext and delegate to provider
      const abortController = new AbortController();

      // Wire the assistant-ui abort signal if available
      const externalSignal = (options as { abortSignal?: AbortSignal })
        .abortSignal;
      if (externalSignal) {
        if (externalSignal.aborted) {
          abortController.abort();
        } else {
          externalSignal.addEventListener(
            "abort",
            () => abortController.abort(),
            { once: true },
          );
        }
      }

      const ctx: RunContext = {
        prompt,
        sessionId,
        model,
        cwd,
        effort,
        abortSignal: abortController.signal,
        threadId,
      };

      // Generate a unique process tracking ID
      const processTrackingId = `${provider.id}-${threadId}-${Date.now()}`;

      try {
        // Yield from the provider's run generator
        yield* provider.run(ctx);

        // 11. Success: set status idle
        setStatus(threadId, "idle", title);
      } catch (err) {
        // 12. Error: set status error, show crash toast
        setStatus(threadId, "error", title);

        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        toast.error(`Agent crashed: ${title ?? threadId}`, {
          description: errorMessage,
          duration: 8000,
        });

        throw err;
      } finally {
        // Clean up process tracking
        try {
          await processManager.untrackProcess(processTrackingId);
        } catch {
          // Process may not have been tracked yet
        }
      }

      // 13. Track PID for process management (post-run for providers
      // that expose PID after invocation starts)
      if (provider.id === "codex") {
        try {
          const pid = await getCodexPid();
          if (pid) {
            await processManager.trackProcess(
              processTrackingId,
              threadId,
              "codex",
              pid,
            );
          }
        } catch {
          // PID retrieval is best-effort
        }
      }
    },
  };
}
