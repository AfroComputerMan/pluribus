import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { createOrchestratedAdapter } from "@/lib/orchestration/orchestrated-adapter";
import { createProviderRegistry } from "@/lib/providers/provider-registry";
import { createAgentProcessManager } from "@/lib/orchestration/agent-process-manager";
import {
  AgentSdkSidecar,
  createAgentSdkProvider,
} from "@/lib/providers/agent-sdk-provider";
import { createCodexProvider } from "@/lib/providers/codex-provider";
import { createSQLiteThreadListAdapter } from "@/lib/sqlite-thread-list-adapter";
import { ApprovalBanner } from "@/components/assistant-ui/approval-banner";
import { ThreadStatusToasts } from "@/components/ThreadStatusToasts";

// ---------------------------------------------------------------------------
// Module-level singletons — created once on app load
// ---------------------------------------------------------------------------

const registry = createProviderRegistry();
const processManager = createAgentProcessManager();
const sidecar = new AgentSdkSidecar();

// Register providers
registry.register(createAgentSdkProvider(() => sidecar));
registry.register(createCodexProvider());

// Run orphan cleanup on module load (silent, no user notification)
processManager
  .cleanupOrphans()
  .then((n) => {
    if (n > 0) console.log(`Cleaned up ${n} orphan processes`);
  })
  .catch((err) => console.error("Orphan cleanup failed:", err));

const threadListAdapter = createSQLiteThreadListAdapter();

/** Inner hook -- creates the per-thread local runtime with the orchestrated adapter. */
function useRuntimeHook() {
  return useLocalRuntime(
    useMemo(() => createOrchestratedAdapter(registry, processManager), []),
  );
}

/**
 * Provides the assistant-ui runtime context with SQLite-backed
 * thread list persistence and per-thread message history.
 */
export function RuntimeProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useRuntimeHook,
    adapter: threadListAdapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>{children}</TooltipProvider>
      <ApprovalBanner />
      <ThreadStatusToasts />
      <Toaster richColors position="bottom-right" />
    </AssistantRuntimeProvider>
  );
}

/** Expose the process manager for exit confirmation dialog. */
export { processManager };
