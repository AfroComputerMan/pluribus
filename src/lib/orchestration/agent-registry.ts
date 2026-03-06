import type { ConcurrencyGovernor } from "@/lib/orchestration/concurrency-governor";
import type { AgentProcessManager } from "@/lib/orchestration/agent-process-manager";
import type { ProviderRegistry } from "@/lib/providers/provider-registry";
import type { WriteSerializer } from "@/lib/orchestration/write-serializer";
import type { AgentStatus, AgentStatusRecord } from "@/lib/orchestration/agent-status";
import type { useAgentStatusStore } from "@/lib/orchestration/agent-status-store";

/**
 * Dependencies injected into AgentRegistry for testability.
 */
export interface AgentRegistryDeps {
  governor: ConcurrencyGovernor;
  processManager: AgentProcessManager;
  providerRegistry: ProviderRegistry;
  statusStore: typeof useAgentStatusStore;
  writeSerializer: WriteSerializer;
  /** DB operations -- extracted interface for testability */
  db: {
    threads: {
      updateAgentStatus: (id: string, agentStatus: string | null) => Promise<void>;
      updateProviderType: (id: string, providerType: string | null) => Promise<void>;
      listByAgentStatus: (agentStatus: string) => Promise<Array<{ id: string; cwd: string | null; model: string | null; title: string | null }>>;
      archiveStaleCompleted: (daysOld: number) => Promise<number>;
      get: (id: string) => Promise<{ id: string; cwd: string | null; model: string | null; title: string | null } | null>;
    };
  };
}

/**
 * AgentRegistry -- central coordinator for all agent lifecycle operations.
 *
 * Delegates to ConcurrencyGovernor for slot management, AgentProcessManager
 * for PID tracking, and ProviderRegistry for model routing. Does NOT call
 * provider.run() -- the OrchestratedAdapter handles actual execution.
 */
export class AgentRegistry {
  private readonly deps: AgentRegistryDeps;

  constructor(deps: AgentRegistryDeps) {
    this.deps = deps;
  }

  /**
   * Request a slot for an agent. Returns 'running' if a slot was acquired,
   * 'queued' if the agent must wait.
   */
  async spawn(
    threadId: string,
    cwd: string,
    model: string,
  ): Promise<"running" | "queued"> {
    const { governor, statusStore, writeSerializer, db } = this.deps;

    const providerType = this._resolveProviderType(model);
    const result = governor.acquire(threadId);

    if (result === "queued") {
      statusStore.getState().setStatus(threadId, "queued", {
        cwd,
        providerType,
      });
      await writeSerializer.serialize(() =>
        db.threads.updateAgentStatus(threadId, "queued"),
      );
      return "queued";
    }

    // acquired
    statusStore.getState().setStatus(threadId, "running", {
      cwd,
      providerType,
    });
    await writeSerializer.serialize(async () => {
      await db.threads.updateAgentStatus(threadId, "running");
      await db.threads.updateProviderType(threadId, providerType);
    });
    return "running";
  }

  /**
   * Kill an agent -- terminate process, release slot, promote queued.
   */
  async kill(threadId: string): Promise<void> {
    const { processManager, governor, statusStore, writeSerializer, db } = this.deps;

    // Kill process if tracked (ignore errors -- process may already be dead)
    try {
      await processManager.untrackProcess(threadId);
    } catch {
      // Process may not exist
    }

    statusStore.getState().setStatus(threadId, "error", {
      errorHint: "killed by user",
    });
    await writeSerializer.serialize(() =>
      db.threads.updateAgentStatus(threadId, "error"),
    );

    // Release slot and promote next queued agent
    const promoted = governor.release(threadId);
    if (promoted) {
      await this._promoteAgent(promoted);
    }
  }

  /**
   * Restart an agent -- kill existing process and re-acquire the slot.
   * Does NOT release the governor slot (reuses the current one).
   */
  async restart(threadId: string): Promise<"running" | "queued"> {
    const { processManager, statusStore, writeSerializer, db } = this.deps;

    // Load thread info from DB
    const thread = await db.threads.get(threadId);
    if (!thread) {
      throw new Error(`Cannot restart: thread ${threadId} not found in DB`);
    }

    // Kill existing process if any (without releasing governor slot)
    try {
      await processManager.untrackProcess(threadId);
    } catch {
      // Process may not exist
    }

    statusStore.getState().setStatus(threadId, "running", {
      cwd: thread.cwd ?? undefined,
      providerType: thread.model ? this._resolveProviderType(thread.model) : undefined,
      errorHint: undefined, // clear error
    });
    await writeSerializer.serialize(() =>
      db.threads.updateAgentStatus(threadId, "running"),
    );

    return "running";
  }

  /**
   * Cancel a queued agent before it starts.
   */
  cancelQueued(threadId: string): boolean {
    const { governor, statusStore, writeSerializer, db } = this.deps;

    const cancelled = governor.cancelQueued(threadId);
    if (!cancelled) return false;

    statusStore.getState().removeStatus(threadId);
    // Fire-and-forget DB update
    writeSerializer.serialize(() =>
      db.threads.updateAgentStatus(threadId, null),
    );
    return true;
  }

  /**
   * Mark an agent as completed. Releases slot and promotes next queued.
   */
  async markCompleted(threadId: string): Promise<void> {
    const { governor, statusStore, writeSerializer, db } = this.deps;

    statusStore.getState().setStatus(threadId, "completed");
    await writeSerializer.serialize(() =>
      db.threads.updateAgentStatus(threadId, "completed"),
    );

    const promoted = governor.release(threadId);
    if (promoted) {
      await this._promoteAgent(promoted);
    }
  }

  /**
   * Mark an agent as errored. Releases slot and promotes next queued.
   */
  async markError(threadId: string, errorHint?: string): Promise<void> {
    const { governor, statusStore, writeSerializer, db } = this.deps;

    statusStore.getState().setStatus(threadId, "error", { errorHint });
    await writeSerializer.serialize(() =>
      db.threads.updateAgentStatus(threadId, "error"),
    );

    const promoted = governor.release(threadId);
    if (promoted) {
      await this._promoteAgent(promoted);
    }
  }

  /**
   * Mark agent as waiting for user approval (e.g. tool use confirmation).
   */
  markWaitingApproval(threadId: string): void {
    this.deps.statusStore.getState().setStatus(threadId, "waiting-approval");
    this.deps.writeSerializer.serialize(() =>
      this.deps.db.threads.updateAgentStatus(threadId, "waiting-approval"),
    );
  }

  /**
   * Mark approval granted -- transition back to running.
   */
  markApprovalGranted(threadId: string): void {
    this.deps.statusStore.getState().setStatus(threadId, "running");
    this.deps.writeSerializer.serialize(() =>
      this.deps.db.threads.updateAgentStatus(threadId, "running"),
    );
  }

  /**
   * Get the current status record for a thread.
   */
  getStatus(threadId: string): AgentStatusRecord | undefined {
    return this.deps.statusStore.getState().statuses.get(threadId);
  }

  /**
   * List all active (non-idle) agents with their status records.
   */
  listActive(): Array<{ threadId: string } & AgentStatusRecord> {
    const statuses = this.deps.statusStore.getState().statuses;
    const result: Array<{ threadId: string } & AgentStatusRecord> = [];
    for (const [threadId, record] of statuses) {
      result.push({ threadId, ...record });
    }
    return result;
  }

  /**
   * Initialize from DB on startup. Handles crash recovery:
   * - Previously-running agents are marked as 'error' with 'process lost'
   * - Completed agents older than 7 days are auto-archived
   * - All non-null statuses are loaded into the Zustand store
   */
  async initFromDb(): Promise<void> {
    const { statusStore, writeSerializer, db } = this.deps;

    // Crash recovery: mark running agents as error
    const runningAgents = await db.threads.listByAgentStatus("running");
    for (const agent of runningAgents) {
      await writeSerializer.serialize(() =>
        db.threads.updateAgentStatus(agent.id, "error"),
      );
    }

    // Auto-archive stale completed agents (7-day threshold)
    await writeSerializer.serialize(() =>
      db.threads.archiveStaleCompleted(7),
    );

    // Load all non-null agent statuses into store
    const records: Array<{ threadId: string } & AgentStatusRecord> = [];

    for (const status of ["running", "error", "queued", "completed", "waiting-approval"] as AgentStatus[]) {
      const threads = await db.threads.listByAgentStatus(status);
      for (const thread of threads) {
        // Running agents were just marked as error above
        const effectiveStatus: AgentStatus =
          status === "running" ? "error" : status;
        records.push({
          threadId: thread.id,
          status: effectiveStatus,
          unread: false,
          cwd: thread.cwd ?? undefined,
          title: thread.title ?? undefined,
          errorHint: effectiveStatus === "error" && status === "running"
            ? "process lost"
            : undefined,
        });
      }
    }

    statusStore.getState().loadFromDb(records);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _resolveProviderType(model: string): string {
    try {
      const provider = this.deps.providerRegistry.getProviderForModel(model);
      return provider.type;
    } catch {
      return "unknown";
    }
  }

  private async _promoteAgent(threadId: string): Promise<void> {
    const { statusStore, writeSerializer, db } = this.deps;
    statusStore.getState().setStatus(threadId, "running");
    await writeSerializer.serialize(() =>
      db.threads.updateAgentStatus(threadId, "running"),
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgentRegistry(deps: AgentRegistryDeps): AgentRegistry {
  return new AgentRegistry(deps);
}
