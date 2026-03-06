/**
 * ConcurrencyGovernor - FIFO concurrency limiter for agent execution slots.
 *
 * Limits active agents to 5. Overflow is queued and auto-promoted in FIFO
 * order when a slot opens.
 */
export class ConcurrencyGovernor {
  private readonly maxConcurrent = 5;
  private readonly active = new Set<string>();
  private readonly queue: Array<{
    threadId: string;
    onPromoted: () => void;
  }> = [];

  /**
   * Request an execution slot for a thread.
   * Returns 'acquired' if a slot is available, 'queued' if the thread must wait.
   * Optionally accepts an onPromoted callback invoked when the thread is promoted from queue.
   */
  acquire(
    threadId: string,
    onPromoted?: () => void,
  ): "acquired" | "queued" {
    // Idempotent: if already active, return acquired
    if (this.active.has(threadId)) {
      return "acquired";
    }

    if (this.active.size < this.maxConcurrent) {
      this.active.add(threadId);
      return "acquired";
    }

    // Already queued? Don't double-queue
    if (this.queue.some((entry) => entry.threadId === threadId)) {
      return "queued";
    }

    this.queue.push({ threadId, onPromoted: onPromoted ?? (() => {}) });
    return "queued";
  }

  /**
   * Release a slot for a thread. If agents are queued, promotes the next one (FIFO).
   * Returns the promoted threadId or null.
   */
  release(threadId: string): string | null {
    if (!this.active.delete(threadId)) {
      return null;
    }

    if (this.queue.length === 0) {
      return null;
    }

    const next = this.queue.shift()!;
    this.active.add(next.threadId);
    next.onPromoted();
    return next.threadId;
  }

  /**
   * Cancel a queued agent before it starts. Returns true if found and removed.
   */
  cancelQueued(threadId: string): boolean {
    const idx = this.queue.findIndex((entry) => entry.threadId === threadId);
    if (idx === -1) {
      return false;
    }
    this.queue.splice(idx, 1);
    return true;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get queuedCount(): number {
    return this.queue.length;
  }
}
