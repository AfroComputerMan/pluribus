import type { ExecutionEvent } from '@/integrations';
import { logger } from '@/observability/logger';
import type { IsolationStrategy, RuntimeTask } from '@/runtime/types';

const log = logger.child('runtime:shared');

/**
 * SharedProcessStrategy executes tasks in the current process with no isolation.
 * Provides basic resource monitoring and limit enforcement.
 */
export class SharedProcessStrategy implements IsolationStrategy {
  readonly level = 'shared' as const;

  private activeExecutions = new Map<string, AbortController>();

  async prepare(_task: RuntimeTask): Promise<void> {
    // No preparation needed for shared process execution
  }

  async *execute(task: RuntimeTask): AsyncGenerator<ExecutionEvent> {
    const abortController = new AbortController();
    this.activeExecutions.set(task.id, abortController);

    const startTime = Date.now();
    const timeoutMs = task.timeout || task.resourceLimits?.maxDurationMs;

    log.info('Starting shared process execution', { taskId: task.id, timeout: timeoutMs });

    // Setup timeout
    const timeoutHandle = timeoutMs
      ? setTimeout(() => {
          log.warn('Execution timeout exceeded', { taskId: task.id, timeoutMs });
          abortController.abort(new Error(`Execution timeout of ${timeoutMs}ms exceeded`));
        }, timeoutMs)
      : undefined;

    // Setup memory monitoring
    const monitoringInterval = setInterval(() => {
      if (task.resourceLimits?.maxMemoryMB) {
        const currentMemoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
        if (currentMemoryMB > task.resourceLimits.maxMemoryMB) {
          log.warn('Memory limit exceeded', {
            taskId: task.id,
            currentMB: currentMemoryMB.toFixed(2),
          });
          abortController.abort(
            new Error(`Memory limit exceeded (current: ${currentMemoryMB.toFixed(2)}MB)`)
          );
        }
      }
    }, 1000);

    try {
      for await (const event of task.adapter.execute(task.connection, task.task)) {
        if (abortController.signal.aborted) {
          throw new Error('Execution aborted');
        }
        yield event;
        if (event.type === 'completed' || event.type === 'error') {
          break;
        }
      }

      log.info('Shared process execution completed', {
        taskId: task.id,
        wallTimeMs: Date.now() - startTime,
      });
    } catch (error) {
      log.error('Execution error', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      yield { type: 'error', error: error instanceof Error ? error : new Error(String(error)) };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      clearInterval(monitoringInterval);
      this.activeExecutions.delete(task.id);
    }
  }

  async cleanup(executionId: string): Promise<void> {
    const abortController = this.activeExecutions.get(executionId);
    if (abortController && !abortController.signal.aborted) {
      abortController.abort(new Error('Cleanup requested'));
      this.activeExecutions.delete(executionId);
    }
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
