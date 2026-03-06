import { describe, it, expect } from "vitest";
import { ConcurrencyGovernor } from "@/lib/orchestration/concurrency-governor";

describe("ConcurrencyGovernor", () => {
  it("acquire() returns 'acquired' when fewer than 5 active agents", () => {
    const gov = new ConcurrencyGovernor();
    expect(gov.acquire("thread-1")).toBe("acquired");
    expect(gov.activeCount).toBe(1);
  });

  it("acquire() returns 'acquired' for up to 5 agents", () => {
    const gov = new ConcurrencyGovernor();
    for (let i = 1; i <= 5; i++) {
      expect(gov.acquire(`thread-${i}`)).toBe("acquired");
    }
    expect(gov.activeCount).toBe(5);
    expect(gov.queuedCount).toBe(0);
  });

  it("acquire() returns 'queued' when 5 agents are already active", () => {
    const gov = new ConcurrencyGovernor();
    for (let i = 1; i <= 5; i++) {
      gov.acquire(`thread-${i}`);
    }
    expect(gov.acquire("thread-6")).toBe("queued");
    expect(gov.activeCount).toBe(5);
    expect(gov.queuedCount).toBe(1);
  });

  it("release() promotes the next queued agent in FIFO order", () => {
    const gov = new ConcurrencyGovernor();
    for (let i = 1; i <= 5; i++) {
      gov.acquire(`thread-${i}`);
    }

    const promotedCallbacks: string[] = [];
    gov.acquire("thread-6", () => promotedCallbacks.push("thread-6"));
    gov.acquire("thread-7", () => promotedCallbacks.push("thread-7"));

    const promoted = gov.release("thread-1");
    expect(promoted).toBe("thread-6");
    expect(promotedCallbacks).toEqual(["thread-6"]);
    expect(gov.activeCount).toBe(5);
    expect(gov.queuedCount).toBe(1);

    const promoted2 = gov.release("thread-2");
    expect(promoted2).toBe("thread-7");
    expect(promotedCallbacks).toEqual(["thread-6", "thread-7"]);
  });

  it("cancelQueued() removes a specific agent from the queue", () => {
    const gov = new ConcurrencyGovernor();
    for (let i = 1; i <= 5; i++) {
      gov.acquire(`thread-${i}`);
    }
    gov.acquire("thread-6");
    gov.acquire("thread-7");

    expect(gov.cancelQueued("thread-6")).toBe(true);
    expect(gov.queuedCount).toBe(1);

    const promoted = gov.release("thread-1");
    expect(promoted).toBe("thread-7");
  });

  it("cancelQueued() returns false if threadId is not in queue", () => {
    const gov = new ConcurrencyGovernor();
    expect(gov.cancelQueued("nonexistent")).toBe(false);
  });

  it("release() with empty queue does not error", () => {
    const gov = new ConcurrencyGovernor();
    gov.acquire("thread-1");
    const promoted = gov.release("thread-1");
    expect(promoted).toBeNull();
    expect(gov.activeCount).toBe(0);
    expect(gov.queuedCount).toBe(0);
  });

  it("activeCount and queuedCount are accurate", () => {
    const gov = new ConcurrencyGovernor();
    expect(gov.activeCount).toBe(0);
    expect(gov.queuedCount).toBe(0);

    for (let i = 1; i <= 7; i++) {
      gov.acquire(`thread-${i}`);
    }
    expect(gov.activeCount).toBe(5);
    expect(gov.queuedCount).toBe(2);

    gov.release("thread-3");
    expect(gov.activeCount).toBe(5);
    expect(gov.queuedCount).toBe(1);
  });

  it("double-acquire for same threadId is idempotent", () => {
    const gov = new ConcurrencyGovernor();
    expect(gov.acquire("thread-1")).toBe("acquired");
    expect(gov.acquire("thread-1")).toBe("acquired");
    expect(gov.activeCount).toBe(1);
  });

  it("release() for a non-active threadId does not error", () => {
    const gov = new ConcurrencyGovernor();
    const promoted = gov.release("nonexistent");
    expect(promoted).toBeNull();
    expect(gov.activeCount).toBe(0);
  });
});
