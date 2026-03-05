import { type Child } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { db } from "@/lib/db";
import { log } from "@/lib/providers/shared";

const LOG_PREFIX = "ProcessManager";

// ---------------------------------------------------------------------------
// AgentProcessManager -- centralized process lifecycle management
// ---------------------------------------------------------------------------

/**
 * Tracks agent process PIDs in SQLite for crash-recovery orphan cleanup,
 * and holds in-memory `Child` references for processes spawned in this
 * session (allowing direct `child.kill()`).
 */
export class AgentProcessManager {
  /**
   * In-memory map of active Child handles for the current session.
   * These can be killed directly via `child.kill()`.
   * For crash-recovery (orphans from a previous session), we only have PIDs
   * and must use the Tauri `kill_pid` command.
   */
  private readonly children = new Map<string, Child>();

  /**
   * Track a newly spawned process. Writes the PID to SQLite for crash
   * recovery and optionally stores the Child handle for direct killing.
   */
  async trackProcess(
    id: string,
    threadId: string,
    provider: string,
    pid: number,
    child?: Child,
  ): Promise<void> {
    await db.processes.track(id, provider, pid, threadId);
    if (child) {
      this.children.set(id, child);
    }
    log(LOG_PREFIX, `Tracked process ${id} (pid=${pid}, provider=${provider}, thread=${threadId})`);
  }

  /**
   * Stop tracking a process. Removes from both SQLite and in-memory map.
   */
  async untrackProcess(id: string): Promise<void> {
    this.children.delete(id);
    await db.processes.untrack(id);
    log(LOG_PREFIX, `Untracked process ${id}`);
  }

  /**
   * On startup: query all processes from the previous session and attempt
   * to kill any that are still running. Clears the table afterwards.
   *
   * Returns the number of processes that were killed.
   * Silent cleanup -- no user-facing notifications.
   */
  async cleanupOrphans(): Promise<number> {
    const orphans = await db.processes.getAll();
    if (orphans.length === 0) return 0;

    let killed = 0;

    for (const proc of orphans) {
      try {
        const success = await invoke<boolean>("kill_pid", { pid: proc.pid });
        if (success) {
          killed++;
          log(LOG_PREFIX, `Killed orphan process pid=${proc.pid} (provider=${proc.provider})`);
        } else {
          log(LOG_PREFIX, `Orphan process pid=${proc.pid} already exited`);
        }
      } catch (err) {
        log(LOG_PREFIX, `Failed to clean up orphan pid=${proc.pid}:`, err);
      }
    }

    // Clear all orphan records regardless of kill success
    await db.processes.clearAll();
    log(LOG_PREFIX, `Cleaned up ${orphans.length} orphan records (${killed} killed)`);

    return killed;
  }

  /**
   * Kill all currently tracked processes and clear the table.
   * Prefers in-memory Child.kill() when available, falls back to Tauri kill_pid command.
   */
  async killAll(): Promise<void> {
    const processes = await db.processes.getAll();

    for (const proc of processes) {
      const child = this.children.get(proc.id);
      if (child) {
        try {
          await child.kill();
          log(LOG_PREFIX, `Killed child ${proc.id} via handle`);
        } catch (err) {
          log(LOG_PREFIX, `Failed to kill child ${proc.id} via handle:`, err);
        }
      } else {
        // Fall back to Tauri command for processes without a Child handle
        try {
          await invoke("kill_pid", { pid: proc.pid });
          log(LOG_PREFIX, `Killed process pid=${proc.pid} via kill_pid command`);
        } catch (err) {
          log(LOG_PREFIX, `Failed to kill process pid=${proc.pid}:`, err);
        }
      }
    }

    this.children.clear();
    await db.processes.clearAll();
    log(LOG_PREFIX, "All tracked processes killed and cleared");
  }

  /** Check whether there are any active tracked processes. */
  async hasActiveProcesses(): Promise<boolean> {
    const all = await db.processes.getAll();
    return all.length > 0;
  }

  /**
   * Get descriptions of active agents for UI display.
   * Queries active_processes joined with threads for titles.
   */
  async getActiveAgentDescriptions(): Promise<
    Array<{ threadId: string; title?: string }>
  > {
    const processes = await db.processes.getAll();
    const results: Array<{ threadId: string; title?: string }> = [];

    for (const proc of processes) {
      if (!proc.thread_id) continue;
      const thread = await db.threads.get(proc.thread_id);
      results.push({
        threadId: proc.thread_id,
        title: thread?.title ?? undefined,
      });
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgentProcessManager(): AgentProcessManager {
  return new AgentProcessManager();
}
