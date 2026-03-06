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
import type { AgentRegistry } from "@/lib/orchestration/agent-registry";
import type { RunContext } from "@/lib/providers/types";
import { extractUserPrompt } from "@/lib/providers/shared";
import { db } from "@/lib/db";
import { resolveModel, resolveEffort } from "@/lib/models";

/**
 * Create the orchestrated adapter that wraps the provider registry.
 *
 * This is the only ChatModelAdapter the app needs. It:
 * 1. Reads thread config (model, effort, cwd) from SQLite
 * 2. Resolves the correct provider via the registry
 * 3. Manages agent lifecycle via the AgentRegistry
 * 4. Tracks PIDs via the process manager
 * 5. Shows crash toasts on errors
 */
export function createOrchestratedAdapter(
  registry: ProviderRegistry,
  agentRegistry: AgentRegistry,
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

      // 9. Request slot from AgentRegistry
      // If queued, wait for promotion via a promise resolved by the governor callback.
      let promotionResolve: (() => void) | null = null;
      const promotionPromise = new Promise<void>((resolve) => {
        promotionResolve = resolve;
      });

      const spawnResult = await agentRegistry.spawn(
        threadId,
        cwd,
        model,
        () => {
          // Governor onPromoted callback -- fires when this queued agent gets a slot
          toast.success(`Agent ${title ?? threadId} started (was queued)`);
          promotionResolve?.();
        },
      );

      if (spawnResult === "queued") {
        toast.info(
          "5 agents running -- this one will start when a slot opens",
        );
        await promotionPromise;
      }

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

      // Generate a unique process tracking ID
      const processTrackingId = `${provider.id}-${threadId}-${Date.now()}`;

      const ctx: RunContext = {
        prompt,
        sessionId,
        model,
        cwd,
        effort,
        abortSignal: abortController.signal,
        threadId,
        onProcessStarted: (pid: number) => {
          processManager
            .trackProcess(processTrackingId, threadId, provider.id, pid)
            .catch(() => {});
        },
      };

      try {
        // Yield from the provider's run generator
        yield* provider.run(ctx);

        // 11. Success: mark completed
        await agentRegistry.markCompleted(threadId);
      } catch (err) {
        // 12. Error: mark error, show crash toast
        await agentRegistry.markError(
          threadId,
          err instanceof Error ? err.message : "Unknown error",
        );

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

        // Safety net: ensure governor slot is released if not already
        // (markCompleted/markError already release, but in case of unexpected
        // exit paths, this ensures no slot leak -- release is idempotent)
        try {
          agentRegistry.ensureSlotReleased(threadId);
        } catch {
          // Best-effort cleanup
        }
      }
    },
  };
}
