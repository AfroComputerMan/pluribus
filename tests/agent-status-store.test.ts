import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAgentStatusStore } from "@/lib/orchestration/agent-status-store";

describe("AgentStatusStore", () => {
  beforeEach(() => {
    // Reset store between tests
    useAgentStatusStore.setState({
      statuses: new Map(),
      currentThreadId: null,
    });
  });

  it("setStatus creates a new record", () => {
    const { setStatus } = useAgentStatusStore.getState();
    setStatus("t1", "running", { cwd: "/home/user/project", providerType: "agent-sdk" });

    const record = useAgentStatusStore.getState().statuses.get("t1");
    expect(record).toBeDefined();
    expect(record!.status).toBe("running");
    expect(record!.cwd).toBe("/home/user/project");
    expect(record!.providerType).toBe("agent-sdk");
    expect(record!.unread).toBe(false);
  });

  it("setStatus with terminal status on background thread sets unread=true", () => {
    const store = useAgentStatusStore.getState();
    store.setCurrentThread("current-thread");
    store.setStatus("bg-thread", "running");
    store.setStatus("bg-thread", "completed");

    const record = useAgentStatusStore.getState().statuses.get("bg-thread");
    expect(record!.status).toBe("completed");
    expect(record!.unread).toBe(true);
    expect(record!.finishedAt).toBeDefined();
  });

  it("setStatus with terminal status on current thread does NOT set unread", () => {
    const store = useAgentStatusStore.getState();
    store.setCurrentThread("t1");
    store.setStatus("t1", "running");
    store.setStatus("t1", "completed");

    const record = useAgentStatusStore.getState().statuses.get("t1");
    expect(record!.status).toBe("completed");
    expect(record!.unread).toBe(false);
  });

  it("markRead clears unread flag", () => {
    const store = useAgentStatusStore.getState();
    store.setCurrentThread("other");
    store.setStatus("t1", "running");
    store.setStatus("t1", "error", { errorHint: "crashed" });

    expect(useAgentStatusStore.getState().statuses.get("t1")!.unread).toBe(true);

    useAgentStatusStore.getState().markRead("t1");
    expect(useAgentStatusStore.getState().statuses.get("t1")!.unread).toBe(false);
  });

  it("loadFromDb populates statuses map", () => {
    const store = useAgentStatusStore.getState();
    store.loadFromDb([
      { threadId: "t1", status: "running", unread: false, cwd: "/a" },
      { threadId: "t2", status: "error", unread: true, errorHint: "process lost" },
    ]);

    const statuses = useAgentStatusStore.getState().statuses;
    expect(statuses.size).toBe(2);
    expect(statuses.get("t1")!.status).toBe("running");
    expect(statuses.get("t2")!.errorHint).toBe("process lost");
  });

  it("removeStatus deletes the record", () => {
    const store = useAgentStatusStore.getState();
    store.setStatus("t1", "running");
    expect(useAgentStatusStore.getState().statuses.has("t1")).toBe(true);

    useAgentStatusStore.getState().removeStatus("t1");
    expect(useAgentStatusStore.getState().statuses.has("t1")).toBe(false);
  });

  it("logs warning on invalid transition but still sets status", () => {
    const store = useAgentStatusStore.getState();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    store.setStatus("t1", "completed");
    // completed -> error is not a valid transition (only completed -> running is valid)
    store.setStatus("t1", "error");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid transition"),
    );
    // But the status is still set
    expect(useAgentStatusStore.getState().statuses.get("t1")!.status).toBe("error");

    warnSpy.mockRestore();
  });

  it("setStatus with error clears errorHint on non-terminal transition", () => {
    const store = useAgentStatusStore.getState();
    store.setStatus("t1", "error", { errorHint: "something broke" });
    expect(useAgentStatusStore.getState().statuses.get("t1")!.errorHint).toBe("something broke");

    // Transition back to running should clear errorHint
    store.setStatus("t1", "running");
    expect(useAgentStatusStore.getState().statuses.get("t1")!.errorHint).toBeUndefined();
  });
});
