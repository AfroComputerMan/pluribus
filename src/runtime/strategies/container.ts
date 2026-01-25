import type { ExecutionEvent } from '@/integrations';
import { InternalError } from '@/lib/errors';
import { logger } from '@/observability/logger';
import type { ContainerOptions, IsolationStrategy, RuntimeTask } from '@/runtime/types';

const VALID_EVENT_TYPES = [
  'started',
  'thinking',
  'tool-call',
  'tool-result',
  'output',
  'completed',
  'error',
  'cost',
];

/**
 * Container isolation strategy that executes tasks in Docker containers.
 * Provides strong isolation with resource limits and network controls.
 */
export class ContainerIsolationStrategy implements IsolationStrategy {
  readonly level = 'container' as const;
  private readonly log = logger.child('runtime:container');
  private readonly runningContainers = new Map<string, string>();
  private readonly defaultOptions: ContainerOptions;

  constructor(defaultOptions: ContainerOptions) {
    this.defaultOptions = defaultOptions;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(['docker', '--version'], { stdout: 'pipe', stderr: 'pipe' });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  }

  async prepare(task: RuntimeTask): Promise<void> {
    const image = this.defaultOptions.image;
    this.log.info('Preparing container', { executionId: task.id, image });

    const inspectProc = Bun.spawn(['docker', 'image', 'inspect', image], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if ((await inspectProc.exited) !== 0) {
      this.log.info('Pulling container image', { executionId: task.id, image });
      const pullProc = Bun.spawn(['docker', 'pull', image], { stdout: 'pipe', stderr: 'pipe' });
      if ((await pullProc.exited) !== 0) {
        const stderr = await new Response(pullProc.stderr).text();
        throw new InternalError(`Failed to pull image ${image}: ${stderr}`);
      }
    }
  }

  async *execute(task: RuntimeTask): AsyncGenerator<ExecutionEvent> {
    const options = {
      ...this.defaultOptions,
      resourceLimits: task.resourceLimits || this.defaultOptions.resourceLimits,
    };
    const dockerArgs = this.buildDockerArgs(task, options);

    this.log.info('Starting container execution', { executionId: task.id, image: options.image });

    try {
      const proc = Bun.spawn(['docker', 'run', ...dockerArgs], { stdout: 'pipe', stderr: 'pipe' });

      // Track container ID asynchronously
      this.trackContainerId(task.id);

      yield { type: 'started', timestamp: new Date() };

      // Stream stdout
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines.filter((l) => l.trim())) {
          yield this.parseEvent(line) || { type: 'output', content: line };
        }
      }

      if (buffer.trim()) {
        yield this.parseEvent(buffer) || { type: 'output', content: buffer };
      }
      reader.releaseLock();

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        this.log.error('Container execution failed', { executionId: task.id, exitCode, stderr });
        yield {
          type: 'error',
          error: new Error(`Container exited with code ${exitCode}: ${stderr}`),
        };
      } else {
        this.log.info('Container execution completed', { executionId: task.id });
        yield {
          type: 'completed',
          result: { success: true, output: 'Container execution completed' },
        };
      }
    } catch (error) {
      this.log.error('Container execution error', { executionId: task.id, error });
      yield { type: 'error', error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async cleanup(executionId: string): Promise<void> {
    const containerId = this.runningContainers.get(executionId);
    if (!containerId) return;

    this.log.info('Cleaning up container', { executionId, containerId });

    try {
      const stopProc = Bun.spawn(['docker', 'stop', '-t', '10', containerId], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if ((await stopProc.exited) !== 0) {
        await Bun.spawn(['docker', 'kill', containerId], { stdout: 'pipe', stderr: 'pipe' }).exited;
      }
      await Bun.spawn(['docker', 'rm', '-f', containerId], { stdout: 'pipe', stderr: 'pipe' })
        .exited;
    } catch (error) {
      this.log.error('Container cleanup error', { executionId, containerId, error });
    } finally {
      this.runningContainers.delete(executionId);
    }
  }

  private async trackContainerId(taskId: string): Promise<void> {
    try {
      const listProc = Bun.spawn(
        [
          'docker',
          'ps',
          '-a',
          '--filter',
          `label=execution-id=${taskId}`,
          '--format',
          '{{.ID}}',
          '--latest',
        ],
        { stdout: 'pipe', stderr: 'pipe' }
      );
      const id = (await new Response(listProc.stdout).text()).trim();
      if (id) this.runningContainers.set(taskId, id);
    } catch {
      // Non-critical, cleanup will still work
    }
  }

  private buildDockerArgs(task: RuntimeTask, options: ContainerOptions): string[] {
    const args = ['--rm', '--label', `execution-id=${task.id}`];

    if (options.resourceLimits?.maxMemoryMB) {
      args.push(
        '--memory',
        `${options.resourceLimits.maxMemoryMB}m`,
        '--memory-swap',
        `${options.resourceLimits.maxMemoryMB}m`
      );
    }
    if (options.resourceLimits?.maxCpuPercent) {
      args.push('--cpus', (options.resourceLimits.maxCpuPercent / 100).toString());
    }
    if (options.resourceLimits?.maxDurationMs) {
      args.push(
        '--stop-timeout',
        Math.ceil(options.resourceLimits.maxDurationMs / 1000).toString()
      );
    }
    if (options.networkMode) {
      args.push('--network', options.networkMode);
    }
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }
    if (options.volumes) {
      for (const vol of options.volumes) {
        args.push(
          '-v',
          vol.readonly ? `${vol.host}:${vol.container}:ro` : `${vol.host}:${vol.container}`
        );
      }
    }

    return [...args, options.image, ...options.command];
  }

  private parseEvent(line: string): ExecutionEvent | null {
    try {
      const data = JSON.parse(line);
      if (data && typeof data === 'object' && VALID_EVENT_TYPES.includes(data.type)) {
        if (typeof data.timestamp === 'string') data.timestamp = new Date(data.timestamp);
        return data as ExecutionEvent;
      }
    } catch {
      // Not JSON
    }
    return null;
  }
}
