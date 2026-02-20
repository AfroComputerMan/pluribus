/**
 * Router adapter for assistant-ui.
 *
 * Reads the thread's model from SQLite on each run and delegates to either:
 * - agent-sdk-adapter (Claude models)
 * - codex-adapter (Codex models)
 *
 * The Codex adapter is created lazily on first Codex turn and reused after.
 */
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import { createAgentSdkAdapter } from "@/lib/agent-sdk-adapter";
import { createCodexAdapter } from "@/lib/codex-adapter";
import { db } from "@/lib/db";
import { isCodexModel, DEFAULT_MODEL_ID } from "@/lib/models";

export function createRouterAdapter(): ChatModelAdapter {
  const sdkAdapter = createAgentSdkAdapter();
  let codexInstance: ChatModelAdapter | null = null;

  return {
    async *run(options): AsyncGenerator<ChatModelRunResult, void> {
      const threadKey =
        (options as { unstable_threadId?: string }).unstable_threadId?.trim() ??
        "__global__";

      const row = await db.threads.get(threadKey);
      const modelId = row?.model ?? DEFAULT_MODEL_ID;

      const adapter = isCodexModel(modelId)
        ? (codexInstance ??= createCodexAdapter())
        : sdkAdapter;

      for await (const chunk of adapter.run(options) as AsyncIterable<ChatModelRunResult>) {
        yield chunk;
      }
    },
  };
}
