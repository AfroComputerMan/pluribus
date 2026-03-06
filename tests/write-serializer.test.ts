import { describe, it, expect } from "vitest";
import { WriteSerializer } from "@/lib/orchestration/write-serializer";

describe("WriteSerializer", () => {
  it("serialize() executes functions sequentially (no interleaving)", async () => {
    const serializer = new WriteSerializer();
    const order: string[] = [];

    const p1 = serializer.serialize(async () => {
      order.push("start-1");
      await delay(50);
      order.push("end-1");
      return "result-1";
    });

    const p2 = serializer.serialize(async () => {
      order.push("start-2");
      await delay(10);
      order.push("end-2");
      return "result-2";
    });

    await Promise.all([p1, p2]);
    // Without serialization, order would be: start-1, start-2, end-2, end-1
    // With serialization, order must be: start-1, end-1, start-2, end-2
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("serialize() returns the result of the wrapped function", async () => {
    const serializer = new WriteSerializer();
    const result = await serializer.serialize(async () => 42);
    expect(result).toBe(42);
  });

  it("a failed write does not block subsequent writes", async () => {
    const serializer = new WriteSerializer();

    const p1 = serializer.serialize(async () => {
      throw new Error("write-1 failed");
    });

    const p2 = serializer.serialize(async () => "write-2 ok");

    await expect(p1).rejects.toThrow("write-1 failed");
    const result = await p2;
    expect(result).toBe("write-2 ok");
  });

  it("concurrent serialize() calls are chained, not parallel", async () => {
    const serializer = new WriteSerializer();
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const makeTask = () =>
      serializer.serialize(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await delay(10);
        concurrentCount--;
      });

    await Promise.all([makeTask(), makeTask(), makeTask()]);
    expect(maxConcurrent).toBe(1);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
