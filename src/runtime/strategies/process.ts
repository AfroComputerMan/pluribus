import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionEvent } from '@/integrations';
import { logger } from '@/observability/logger';
import type { IsolationStrategy, RuntimeTask } from '@/runtime/types';

const WORKER_SCRIPT = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });

function send(event) { process.stdout.write(JSON.stringify(event) + '\\n'); }

rl.on('line', async (line) => {
  try {
    const task = JSON.parse(line);
    send({ type: 'started', timestamp: new Date().toISOString() });
    send({ type: 'thinking', content: 'Processing: ' + task.task.prompt });
    await new Promise(r => setTimeout(r, 100));
    send({ type: 'completed', result: { success: true, output: 'Execution completed' } });
  } catch (e) {
    send({ type: 'error', error: { message: e.message } });
    process.exit(1);
  }
});

process.on('SIGTERM', () => process.exit(0));
`;

interface ProcessState {
  process: ReturnType<typeof spawn>;
  tempDir: string;
}

export class ProcessIsolationStrategy implements IsolationStrategy {
  readonly level = 'process' as const;
  private processes = new Map<string, ProcessState>();
  private log = logger.child('runtime:process');

  async prepare(_task: RuntimeTask): Promise<void> {
    // Preparation happens in execute to avoid duplication
  }

  async *execute(task: RuntimeTask): AsyncGenerator<ExecutionEvent> {
    this.log.info('Starting process execution', { taskId: task.id, timeout: task.timeout });

    // Create temp directory and worker script
    const tempDir = await mkdtemp(join(tmpdir(), `pluribus-process-${task.id}-`));
    const workerPath = join(tempDir, 'worker.js');
    await writeFile(workerPath, WORKER_SCRIPT, 'utf-8');

    // Build NODE_OPTIONS for memory limits
    const nodeOptions = task.resourceLimits?.maxMemoryMB
      ? `--max-old-space-size=${Math.floor(task.resourceLimits.maxMemoryMB * 0.9)}`
      : '';

    const childProcess = spawn('node', [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: nodeOptions },
    });

    this.processes.set(task.id, { process: childProcess, tempDir });

    // Setup timeout
    let timeoutId: NodeJS.Timeout | undefined;
    if (task.timeout > 0) {
      timeoutId = setTimeout(() => {
        this.log.warn('Process execution timeout', { taskId: task.id });
        childProcess.kill('SIGTERM');
        setTimeout(() => !childProcess.killed && childProcess.kill('SIGKILL'), 5000);
      }, task.timeout);
    }

    try {
      // Send task to worker
      childProcess.stdin?.write(JSON.stringify({
        id: task.id,
        adapter: { id: task.adapter.id, name: task.adapter.name, type: task.adapter.type },
        task: task.task,
        timeout: task.timeout,
      }) + '\n');
      childProcess.stdin?.end();

      // Read events from stdout
      const readline = await import('node:readline');
      const rl = readline.createInterface({ input: childProcess.stdout!, crlfDelay: Number.POSITIVE_INFINITY });

      for await (const line of rl) {
        try {
          const event = JSON.parse(line) as ExecutionEvent;
          if ('timestamp' in event && typeof event.timestamp === 'string') {
            event.timestamp = new Date(event.timestamp);
          }
          yield event;
          if (event.type === 'completed' || event.type === 'error') break;
        } catch {
          this.log.error('Failed to parse event from worker', { taskId: task.id, line });
        }
      }

      // Wait for process exit
      await new Promise<void>((resolve, reject) => {
        childProcess.on('exit', (code, signal) => {
          this.log.info('Process exited', { taskId: task.id, code, signal });
          resolve();
        });
        childProcess.on('error', reject);
      });
    } catch (error) {
      this.log.error('Process execution failed', { taskId: task.id, error: error instanceof Error ? error.message : String(error) });
      yield { type: 'error', error: error instanceof Error ? error : new Error(String(error)) };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      await this.cleanup(task.id);
    }
  }

  async cleanup(executionId: string): Promise<void> {
    const state = this.processes.get(executionId);
    if (!state) return;

    this.log.debug('Cleaning up process', { executionId });

    try {
      if (!state.process.killed) {
        state.process.kill('SIGTERM');
        await Promise.race([
          new Promise<void>(resolve => state.process.on('exit', resolve)),
          new Promise<void>(resolve => setTimeout(() => {
            if (!state.process.killed) state.process.kill('SIGKILL');
            resolve();
          }, 3000)),
        ]);
      }
      await rm(state.tempDir, { recursive: true, force: true });
    } catch (error) {
      this.log.error('Cleanup failed', { executionId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.processes.delete(executionId);
    }
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
