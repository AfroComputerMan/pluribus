import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConcurrencyGovernor } from "@/lib/orchestration/concurrency-governor";
import { WriteSerializer } from "@/lib/orchestration/write-serializer";
import { AgentRegistry, type AgentRegistryDeps } from "@/lib/orchestration/agent-registry";
import { useAgentStatusStore } from "@/lib/orchestration/agent-status-store";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockProcessManager() {
  return {
    trackProcess: vi.fn().mockResolvedValue(undefined),
    untrackProcess: vi.fn().mockResolvedValue(undefined),
    killAll: vi.fn().mockResolvedValue(undefined),
    hasActiveProcesses: vi.fn().mockResolvedValue(false),
    cleanupOrphans: vi.fn().mockResolvedValue(0),
    getActiveAgentDescriptions: vi.fn().mockResolvedValue([]),
  };
}

function createMockProviderRegistry() {
  return {
    getProviderForModel: vi.fn().mockReturnValue({
      type: "agent-sdk",
      supportedModels: ["claude-sonnet-4-20250514"],
    }),
    register: vi.fn(),
    getAllProviders: vi.fn().mockReturnValue([]),
    getAvailableModels: vi.fn().mockReturnValue([]),
  };
}

function createMockDb() {
  return {
    threads: {
      updateAgentStatus: vi.fn().mockResolvedValue(undefined),
      updateProviderType: vi.fn().mockResolvedValue(undefined),
      listByAgentStatus: vi.fn().mockResolvedValue([]),
      archiveStaleCompleted: vi.fn().mockResolvedValue(0),
      get: vi.fn().mockResolvedValue(null),
    },
  };
}

function createDeps(overrides?: Partial<AgentRegistryDeps>): AgentRegistryDeps {
  return {
    governor: new ConcurrencyGovernor(),
    processManager: createMockProcessManager() as unknown as AgentRegistryDeps["processManager"],
    providerRegistry: createMockProviderRegistry() as unknown as AgentRegistryDeps["providerRegistry"],
    statusStore: useAgentStatusStore,
    writeSerializer: new WriteSerializer(),
    db: createMockDb(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentRegistry", () => {
  beforeEach(() => {
    useAgentStatusStore.setState({
      statuses: new Map(),
      currentThreadId: null,
    });
  });

  it("spawn acquires governor slot and sets status to running", async () => {
    const deps = createDeps();
    const registry = new AgentRegistry(deps);

    const result = await registry.spawn("t1", "/home/user/project", "claude-sonnet-4-20250514");

    expect(result).toBe("running");
    const status = registry.getStatus("t1");
    expect(status).toBeDefined();
    expect(status!.status).toBe("running");
    expect(status!.cwd).toBe("/home/user/project");
    expect(status!.providerType).toBe("agent-sdk");

    // DB updated
    expect(deps.db.threads.updateAgentStatus).toHaveBeenCalledWith("t1", "running");
    expect(deps.db.threads.updateProviderType).toHaveBeenCalledWith("t1", "agent-sdk");
  });

  it("spawn at capacity returns queued (6th spawn)", async () => {
    const deps = createDeps();
    const registry = new AgentRegistry(deps);

    // Fill 5 slots
    for (let i = 0; i < 5; i++) {
      const r = await registry.spawn(`t${i}`, "/cwd", "claude-sonnet-4-20250514");
      expect(r).toBe("running");
    }

    // 6th should be queued
    const result = await registry.spawn("t5", "/cwd", "claude-sonnet-4-20250514");
    expect(result).toBe("queued");

    const status = registry.getStatus("t5");
    expect(status!.status).toBe("queued");
  });

  it("kill releases slot and promotes queued agent", async () => {
    const deps = createDeps();
    const registry = new AgentRegistry(deps);

    // Fill slots
    for (let i = 0; i < 5; i++) {
      await registry.spawn(`t${i}`, "/cwd", "claude-sonnet-4-20250514");
    }
    // Queue one
    await registry.spawn("t5", "/cwd", "claude-sonnet-4-20250514");
    expect(registry.getStatus("t5")!.status).toBe("queued");

    // Kill t0 -- should promote t5
    await registry.kill("t0");

    expect(registry.getStatus("t0")!.status).toBe("error");
    expect(registry.getStatus("t5")!.status).toBe("running");
  });

  it("restart loads from DB and re-sets status", async () => {
    const mockDb = createMockDb();
    mockDb.threads.get.mockResolvedValue({
      id: "t1",
      cwd: "/original/cwd",
      model: "claude-sonnet-4-20250514",
      title: "Test Thread",
    });

    const deps = createDeps({ db: mockDb });
    const registry = new AgentRegistry(deps);

    // First spawn
    await registry.spawn("t1", "/original/cwd", "claude-sonnet-4-20250514");
    expect(registry.getStatus("t1")!.status).toBe("running");

    // Simulate error
    await registry.markError("t1", "something broke");
    expect(registry.getStatus("t1")!.status).toBe("error");
    expect(registry.getStatus("t1")!.errorHint).toBe("something broke");

    // Re-acquire slot for restart (since markError released it)
    deps.governor.acquire("t1");

    // Restart
    const result = await registry.restart("t1");
    expect(result).toBe("running");
    expect(registry.getStatus("t1")!.status).toBe("running");
    // errorHint should be cleared (since status is not error, store clears it)
    expect(registry.getStatus("t1")!.errorHint).toBeUndefined();
    expect(registry.getStatus("t1")!.cwd).toBe("/original/cwd");
  });

  it("cancelQueued removes from queue", async () => {
    const deps = createDeps();
    const registry = new AgentRegistry(deps);

    // Fill slots
    for (let i = 0; i < 5; i++) {
      await registry.spawn(`t${i}`, "/cwd", "claude-sonnet-4-20250514");
    }
    await registry.spawn("t5", "/cwd", "claude-sonnet-4-20250514");
    expect(registry.getStatus("t5")!.status).toBe("queued");

    const cancelled = registry.cancelQueued("t5");
    expect(cancelled).toBe(true);
    expect(registry.getStatus("t5")).toBeUndefined();
  });

  it("markCompleted releases slot and promotes queued", async () => {
    const deps = createDeps();
    const registry = new AgentRegistry(deps);

    for (let i = 0; i < 5; i++) {
      await registry.spawn(`t${i}`, "/cwd", "claude-sonnet-4-20250514");
    }
    await registry.spawn("t5", "/cwd", "claude-sonnet-4-20250514");

    await registry.markCompleted("t0");
    expect(registry.getStatus("t0")!.status).toBe("completed");
    expect(registry.getStatus("t5")!.status).toBe("running");
  });

  it("initFromDb marks previously-running as error with process lost", async () => {
    const mockDb = createMockDb();
    mockDb.threads.listByAgentStatus.mockImplementation(async (status: string) => {
      if (status === "running") {
        return [
          { id: "t1", cwd: "/project1", model: "claude-sonnet-4-20250514", title: "Agent 1" },
          { id: "t2", cwd: "/project2", model: "claude-sonnet-4-20250514", title: "Agent 2" },
        ];
      }
      return [];
    });

    const deps = createDeps({ db: mockDb });
    const registry = new AgentRegistry(deps);

    await registry.initFromDb();

    // Both should be marked as error with 'process lost'
    const t1 = registry.getStatus("t1");
    expect(t1!.status).toBe("error");
    expect(t1!.errorHint).toBe("process lost");

    const t2 = registry.getStatus("t2");
    expect(t2!.status).toBe("error");
    expect(t2!.errorHint).toBe("process lost");

    // DB should have been updated
    expect(mockDb.threads.updateAgentStatus).toHaveBeenCalledWith("t1", "error");
    expect(mockDb.threads.updateAgentStatus).toHaveBeenCalledWith("t2", "error");

    // Auto-archive should have been called
    expect(mockDb.threads.archiveStaleCompleted).toHaveBeenCalledWith(7);
  });

  it("cwd is stored per thread (ORCH-08)", async () => {
    const deps = createDeps();
    const registry = new AgentRegistry(deps);

    await registry.spawn("t1", "/home/user/project-a", "claude-sonnet-4-20250514");
    await registry.spawn("t2", "/home/user/project-b", "claude-sonnet-4-20250514");

    expect(registry.getStatus("t1")!.cwd).toBe("/home/user/project-a");
    expect(registry.getStatus("t2")!.cwd).toBe("/home/user/project-b");
  });

  it("listActive returns all tracked agents", async () => {
    const deps = createDeps();
    const registry = new AgentRegistry(deps);

    await registry.spawn("t1", "/cwd1", "claude-sonnet-4-20250514");
    await registry.spawn("t2", "/cwd2", "claude-sonnet-4-20250514");

    const active = registry.listActive();
    expect(active).toHaveLength(2);
    expect(active.map((a) => a.threadId).sort()).toEqual(["t1", "t2"]);
  });

  it("markWaitingApproval and markApprovalGranted toggle status", async () => {
    const deps = createDeps();
    const registry = new AgentRegistry(deps);

    await registry.spawn("t1", "/cwd", "claude-sonnet-4-20250514");
    registry.markWaitingApproval("t1");
    expect(registry.getStatus("t1")!.status).toBe("waiting-approval");

    registry.markApprovalGranted("t1");
    expect(registry.getStatus("t1")!.status).toBe("running");
  });
});
