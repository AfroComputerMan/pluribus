import type { ExecutionEvent } from '@/integrations';
import { logger } from '@/observability';
import type {
  ExecutionRuntime,
  IsolationLevel,
  IsolationStrategy,
  RuntimeResult,
  RuntimeTask,
} from './types';

export interface RuntimeManagerOptions {
  defaultIsolation?: IsolationLevel;
  fallbackOrder?: IsolationLevel[];
}

const DEFAULT_FALLBACK_ORDER: IsolationLevel[] = ['container', 'process', 'shared'];

/**
 * RuntimeManager coordinates strategy selection and execution for agent tasks.
 * Manages multiple isolation strategies with automatic fallback.
 */
export class RuntimeManager implements ExecutionRuntime {
  private readonly strategies = new Map<IsolationLevel, IsolationStrategy>();
  private readonly fallbackOrder: IsolationLevel[];
  private readonly log = logger.child('runtime:manager');

  constructor(options: RuntimeManagerOptions = {}) {
    this.fallbackOrder = options.fallbackOrder || DEFAULT_FALLBACK_ORDER;
  }

  registerStrategy(strategy: IsolationStrategy): void {
    this.strategies.set(strategy.level, strategy);
    this.log.info('Registered isolation strategy', { level: strategy.level });
  }

  getStrategy(level: IsolationLevel): IsolationStrategy | undefined {
    return this.strategies.get(level);
  }

  async execute(task: RuntimeTask, isolation: IsolationLevel): Promise<RuntimeResult> {
    const startedAt = new Date();
    const events: ExecutionEvent[] = [];

    this.log.info('Starting task execution', { taskId: task.id, isolation });

    try {
      const strategy = await this.findAvailableStrategy(isolation);
      if (!strategy) {
        throw new Error(`No available isolation strategy for level '${isolation}' or any fallback`);
      }

      await strategy.prepare(task);

      let output: unknown;
      for await (const event of strategy.execute(task)) {
        events.push(event);
        if (event.type === 'completed') output = event.result.output;
      }

      const completedAt = new Date();
      this.log.info('Task execution completed', { taskId: task.id, duration: completedAt.getTime() - startedAt.getTime() });

      return {
        success: true,
        output,
        events,
        startedAt,
        completedAt,
        resourceUsage: { memoryPeakMB: 0, cpuTimeMs: 0, wallTimeMs: completedAt.getTime() - startedAt.getTime() },
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (!events.some(e => e.type === 'error') && error instanceof Error) {
        events.push({ type: 'error', error });
      }

      this.log.error('Task execution failed', { taskId: task.id, error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        events,
        startedAt,
        completedAt,
        resourceUsage: { memoryPeakMB: 0, cpuTimeMs: 0, wallTimeMs: completedAt.getTime() - startedAt.getTime() },
      };
    }
  }

  async cleanup(executionId: string): Promise<void> {
    this.log.debug('Cleaning up execution', { executionId });
    await Promise.all(
      Array.from(this.strategies.values()).map(s =>
        s.cleanup(executionId).catch(e => this.log.warn('Strategy cleanup failed', { executionId, error: e }))
      )
    );
  }

  private async findAvailableStrategy(preferredLevel: IsolationLevel): Promise<IsolationStrategy | null> {
    const preferred = this.strategies.get(preferredLevel);
    if (preferred && (await preferred.isAvailable())) return preferred;

    for (const level of this.fallbackOrder) {
      const strategy = this.strategies.get(level);
      if (strategy && (await strategy.isAvailable())) {
        this.log.info('Using fallback strategy', { preferred: preferredLevel, fallback: level });
        return strategy;
      }
    }
    return null;
  }
}

export function createRuntimeManager(options?: RuntimeManagerOptions): RuntimeManager {
  return new RuntimeManager(options);
}
