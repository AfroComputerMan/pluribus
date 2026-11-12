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
import { createAgentRegistry } from "@/lib/orchestration/agent-registry";
import { ConcurrencyGovernor } from "@/lib/orchestration/concurrency-governor";
import { WriteSerializer } from "@/lib/orchestration/write-serializer";
import { useAgentStatusStore } from "@/lib/orchestration/agent-status-store";
import {
  AgentSdkSidecar,
  createAgentSdkProvider,
} from "@/lib/providers/agent-sdk-provider";
import { createCodexProvider } from "@/lib/providers/codex-provider";
import { createPiProvider, reconcileClones } from "@/lib/providers/pi-provider";
import { createSQLiteThreadListAdapter } from "@/lib/sqlite-thread-list-adapter";
import { ApprovalBanner } from "@/components/assistant-ui/approval-banner";
import { ThreadStatusToasts } from "@/components/ThreadStatusToasts";
import { ExitGuard } from "@/components/ExitGuard";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Module-level singletons — created once on app load
// ---------------------------------------------------------------------------

const providerRegistry = createProviderRegistry();
const processManager = createAgentProcessManager();
const sidecar = new AgentSdkSidecar();

// Register providers
providerRegistry.register(createAgentSdkProvider(() => sidecar));
providerRegistry.register(createCodexProvider());
providerRegistry.register(createPiProvider());

// Create AgentRegistry with all dependencies
const governor = new ConcurrencyGovernor();
const writeSerializer = new WriteSerializer();
const agentRegistry = createAgentRegistry({
  governor,
  processManager,
  providerRegistry,
  statusStore: useAgentStatusStore,
  writeSerializer,
  db: {
    threads: {
      updateAgentStatus: (id, agentStatus) =>
        db.threads.updateAgentStatus(id, agentStatus),
      updateProviderType: (id, providerType) =>
        db.threads.updateProviderType(id, providerType),
      listByAgentStatus: (agentStatus) =>
        db.threads.listByAgentStatus(agentStatus),
      archiveStaleCompleted: (daysOld) =>
        db.threads.archiveStaleCompleted(daysOld),
      get: (id) => db.threads.get(id),
    },
  },
});

// Run orphan cleanup on module load (silent, no user notification)
processManager
  .cleanupOrphans()
  .then((n) => {
    if (n > 0) console.log(`Cleaned up ${n} orphan processes`);
  })
  .catch((err) => console.error("Orphan cleanup failed:", err));

// Reconcile per-agent clone dirs (#19): log orphaned active clones whose dir
// vanished. Best-effort, retains active clones (the #21 review artifact).
reconcileClones().catch((err) =>
  console.error("Clone reconcile failed:", err),
);

// Initialize AgentRegistry from DB (crash recovery + load persisted statuses)
agentRegistry
  .initFromDb()
  .then(() => console.log("AgentRegistry initialized from DB"))
  .catch((err) => console.error("AgentRegistry init failed:", err));

// Auto-archive stale completed agents (7-day threshold) hourly
const runArchive = () => {
  db.threads
    .archiveStaleCompleted(7)
    .catch((err: unknown) => console.error("Auto-archive failed:", err));
};
runArchive(); // Run once at startup
setInterval(runArchive, 60 * 60 * 1000); // Hourly

const baseThreadListAdapter = createSQLiteThreadListAdapter();

/**
 * Release a thread's backend resources before its DB row is mutated (#26).
 *
 * Resolve the thread's provider type from the row (it is removed by `delete`),
 * find the matching registered provider, and fire its optional `teardown`. Only
 * Pi implements `teardown` (it `pi_stop`s the host child + container); other
 * providers no-op. Best-effort: a missing row / unregistered provider / failed
 * `pi_stop` must never block the delete/archive.
 */
async function teardownThread(remoteId: string): Promise<void> {
  try {
    const row = await db.threads.get(remoteId);
    if (!row) return;
    let provider = row.provider_type
      ? providerRegistry
          .getAllProviders()
          .find((p) => p.id === row.provider_type)
      : undefined;
    // Fallback (#26 review): queued→promoted agents can have a null
    // provider_type in the DB; derive it from the persisted model instead.
    if (!provider && row.model) {
      try {
        provider = providerRegistry.getProviderForModel(row.model);
      } catch {
        // unknown model — leave provider undefined
      }
    }
    await provider?.teardown?.(remoteId);
  } catch (err) {
    console.error("pi teardown on thread close failed (best-effort):", err);
  }
}

const threadListAdapter: ReturnType<typeof createSQLiteThreadListAdapter> = {
  ...baseThreadListAdapter,
  async delete(remoteId: string) {
    await teardownThread(remoteId);
    await baseThreadListAdapter.delete(remoteId);
  },
  async archive(remoteId: string) {
    await teardownThread(remoteId);
    await baseThreadListAdapter.archive(remoteId);
  },
};

/** Inner hook -- creates the per-thread local runtime with the orchestrated adapter. */
function useRuntimeHook() {
  return useLocalRuntime(
    useMemo(
      () =>
        createOrchestratedAdapter(
          providerRegistry,
          agentRegistry,
          processManager,
        ),
      [],
    ),
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
      <ExitGuard />
      <Toaster richColors position="bottom-right" />
    </AssistantRuntimeProvider>
  );
}

/** Expose the process manager for exit confirmation dialog. */
export { processManager, teardownThread };
