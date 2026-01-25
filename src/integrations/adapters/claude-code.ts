import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { CredentialError, IntegrationError } from '@/lib/errors';
import { logger } from '@/observability/logger';
import type {
  AdapterCapabilities,
  AdapterConnection,
  AdapterCredentials,
  AgentAdapter,
  AgentTask,
  CostEstimate,
  ExecutionEvent,
  ExecutionOptions,
  TokenUsage,
} from '../types';

/**
 * Claude Code adapter for executing tasks via the claude CLI
 *
 * This adapter spawns the claude process and communicates via stream-json format.
 * It handles session management, event streaming, and cost tracking.
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';
  readonly type = 'claude-code' as const;

  private log = logger.child('integrations:claude-code');
  private sessions = new Map<string, SessionState>();

  // Pricing for Claude models (USD per 1M tokens)
  private readonly pricing = {
    'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
    'claude-opus-4-5-20251101': { input: 15.0, output: 75.0 },
    'claude-sonnet-3-5-20241022': { input: 3.0, output: 15.0 },
    'claude-haiku-3-5-20241022': { input: 0.8, output: 4.0 },
  };

  private readonly defaultModel = 'claude-sonnet-4-5-20250929';

  async connect(credentials: AdapterCredentials): Promise<AdapterConnection> {
    this.log.info('Connecting to Claude Code');

    // Validate credentials
    if (credentials.type !== 'api-key') {
      throw new CredentialError('Claude Code adapter requires API key credentials');
    }

    // Validate API key format
    const apiKey = credentials.data.key;
    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      throw new CredentialError('Invalid Anthropic API key format');
    }

    // Test connection by checking CLI availability
    const isAvailable = await this.checkCLIAvailable();
    if (!isAvailable) {
      throw new IntegrationError(
        'claude-code',
        'Claude CLI not found in PATH. Install from: https://github.com/anthropics/claude-code'
      );
    }

    const connectionId = randomUUID();
    const connection: AdapterConnection = {
      id: connectionId,
      adapterId: this.id,
      status: 'connected',
      credentials,
      connectedAt: new Date(),
      metadata: {
        cliVersion: await this.getCLIVersion(),
      },
    };

    this.log.info('Connected to Claude Code', { connectionId });
    return connection;
  }

  async disconnect(connection: AdapterConnection): Promise<void> {
    this.log.info('Disconnecting from Claude Code', { connectionId: connection.id });

    // Clean up any active sessions for this connection
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.connectionId === connection.id) {
        this.cleanupSession(sessionId);
      }
    }
  }

  async validateCredentials(credentials: AdapterCredentials): Promise<boolean> {
    try {
      if (credentials.type !== 'api-key') {
        return false;
      }

      const apiKey = credentials.data.key;
      if (!apiKey || !apiKey.startsWith('sk-ant-')) {
        return false;
      }

      // Could make a test API call here, but for now just validate format
      return true;
    } catch {
      return false;
    }
  }

  async *execute(
    connection: AdapterConnection,
    task: AgentTask,
    options?: ExecutionOptions
  ): AsyncGenerator<ExecutionEvent> {
    const sessionId = randomUUID();
    this.log.info('Starting Claude Code execution', { sessionId, connectionId: connection.id });

    let session: SessionState | undefined;
    try {
      // Build command arguments
      const args = this.buildCommandArgs(task, sessionId);

      // Get API key from credentials
      if (connection.credentials.type !== 'api-key') {
        throw new CredentialError('Invalid credentials type for Claude Code');
      }
      const apiKey = connection.credentials.data.key;

      // Spawn claude process
      const childProcess = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: apiKey,
        },
      });

      session = {
        sessionId,
        connectionId: connection.id,
        process: childProcess,
        startedAt: new Date(),
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };

      this.sessions.set(sessionId, session);

      // Setup timeout if specified
      let timeoutId: NodeJS.Timeout | undefined;
      if (options?.timeout && options.timeout > 0) {
        timeoutId = setTimeout(() => {
          this.log.warn('Execution timeout', { sessionId, timeout: options.timeout });
          childProcess.kill('SIGTERM');
          setTimeout(() => {
            if (!childProcess.killed) {
              childProcess.kill('SIGKILL');
            }
          }, 5000);
        }, options.timeout);
      } else if (task.constraints?.maxDuration) {
        timeoutId = setTimeout(() => {
          this.log.warn('Task duration limit exceeded', {
            sessionId,
            maxDuration: task.constraints?.maxDuration,
          });
          childProcess.kill('SIGTERM');
          setTimeout(() => {
            if (!childProcess.killed) {
              childProcess.kill('SIGKILL');
            }
          }, 5000);
        }, task.constraints.maxDuration);
      }

      // Send started event
      const startedEvent: ExecutionEvent = { type: 'started', timestamp: new Date() };
      options?.onEvent?.(startedEvent);
      yield startedEvent;

      // Write prompt to stdin
      if (childProcess.stdin) {
        childProcess.stdin.write(`${task.prompt}\n`);
        childProcess.stdin.end();
      }

      // Process stdout events
      const rl = createInterface({
        input: childProcess.stdout!,
        crlfDelay: Number.POSITIVE_INFINITY,
      });

      let completed = false;
      const outputBuffer: string[] = [];

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const event = this.parseOutputLine(line, session);
          if (event) {
            options?.onEvent?.(event);
            yield event;

            // Track output content
            if (event.type === 'output') {
              outputBuffer.push(event.content);
            }

            // Check for completion
            if (event.type === 'completed' || event.type === 'error') {
              completed = true;
              break;
            }
          }
        } catch (error) {
          this.log.warn('Failed to parse output line', { sessionId, line, error });
          // Continue processing other lines
        }
      }

      // Wait for process exit
      const exitCode = await new Promise<number | null>((resolve) => {
        childProcess.on('exit', (code) => resolve(code));
        childProcess.on('error', () => resolve(null));
      });

      // If not already completed, send completion event
      if (!completed) {
        const finalEvent: ExecutionEvent = {
          type: 'completed',
          result: {
            success: exitCode === 0,
            output: outputBuffer.join('\n'),
            metadata: {
              exitCode,
              sessionId,
              tokenUsage: session.tokenUsage,
            },
          },
        };
        options?.onEvent?.(finalEvent);
        yield finalEvent;
      }

      // Send final cost event
      if (session.tokenUsage.totalTokens > 0) {
        const costEvent: ExecutionEvent = {
          type: 'cost',
          usage: session.tokenUsage,
        };
        options?.onEvent?.(costEvent);
        yield costEvent;
      }

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      this.log.error('Execution failed', { sessionId, error });
      const errorEvent: ExecutionEvent = {
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      };
      options?.onEvent?.(errorEvent);
      yield errorEvent;
    } finally {
      if (session) {
        this.cleanupSession(sessionId);
      }
    }
  }

  getCapabilities(): AdapterCapabilities {
    return {
      supportsStreaming: true,
      supportsTools: true,
      supportsImages: true,
      maxContextTokens: 200_000,
      supportedModels: Object.keys(this.pricing),
    };
  }

  estimateCost(task: AgentTask): CostEstimate {
    // Simple token estimation based on character count
    const promptTokens = Math.ceil(task.prompt.length / 4);
    const contextTokens = task.context ? Math.ceil(task.context.length / 4) : 0;
    const estimatedInputTokens = promptTokens + contextTokens;

    // Estimate output tokens based on constraints or default
    const estimatedOutputTokens = task.constraints?.maxTokens || 4096;

    const model = this.defaultModel;
    const pricing =
      this.pricing[model as keyof typeof this.pricing] || this.pricing[this.defaultModel];

    const inputCost = (estimatedInputTokens / 1_000_000) * pricing.input;
    const outputCost = (estimatedOutputTokens / 1_000_000) * pricing.output;

    return {
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsd: inputCost + outputCost,
      model,
    };
  }

  // Private helper methods

  private buildCommandArgs(task: AgentTask, sessionId: string): string[] {
    const args = [
      '--print', // Non-interactive mode
      '--output-format=stream-json', // Get structured events
      '--no-session-persistence', // Don't save sessions
      `--session-id=${sessionId}`, // Use our session ID
    ];

    // Add model if specified in constraints
    if (task.constraints?.maxTokens) {
      args.push('--max-budget-usd=10'); // Safety limit
    }

    // Add allowed/blocked tools
    if (task.constraints?.allowedTools && task.constraints.allowedTools.length > 0) {
      args.push(`--allowed-tools=${task.constraints.allowedTools.join(',')}`);
    }

    if (task.constraints?.blockedTools && task.constraints.blockedTools.length > 0) {
      args.push(`--disallowed-tools=${task.constraints.blockedTools.join(',')}`);
    }

    // Add context as system prompt if provided
    if (task.context) {
      args.push(`--append-system-prompt=${task.context}`);
    }

    return args;
  }

  private parseOutputLine(line: string, session: SessionState): ExecutionEvent | null {
    try {
      const data = JSON.parse(line);

      // Handle different event types from claude CLI
      switch (data.type) {
        case 'message_start':
          return null; // Already sent 'started' event

        case 'content_block_start':
          if (data.content_block?.type === 'thinking') {
            return { type: 'thinking', content: '' };
          }
          return null;

        case 'content_block_delta':
          if (data.delta?.type === 'thinking_delta') {
            return { type: 'thinking', content: data.delta.thinking || '' };
          }
          if (data.delta?.type === 'text_delta') {
            return { type: 'output', content: data.delta.text || '' };
          }
          return null;

        case 'content_block_stop':
          return null;

        case 'tool_use':
          return {
            type: 'tool-call',
            tool: data.name,
            args: data.input,
          };

        case 'tool_result':
          return {
            type: 'tool-result',
            tool: data.tool_use_id,
            result: data.content,
          };

        case 'message_delta':
          // Update token usage if available
          if (data.usage) {
            session.tokenUsage.inputTokens += data.usage.input_tokens || 0;
            session.tokenUsage.outputTokens += data.usage.output_tokens || 0;
            session.tokenUsage.totalTokens =
              session.tokenUsage.inputTokens + session.tokenUsage.outputTokens;
          }
          return null;

        case 'message_stop':
          // Final token usage
          if (data.usage) {
            session.tokenUsage.inputTokens = data.usage.input_tokens || 0;
            session.tokenUsage.outputTokens = data.usage.output_tokens || 0;
            session.tokenUsage.totalTokens =
              session.tokenUsage.inputTokens + session.tokenUsage.outputTokens;
          }
          return null;

        case 'error':
          return {
            type: 'error',
            error: new IntegrationError('claude-code', data.error?.message || 'Unknown error', {
              details: data.error,
            }),
          };

        default:
          this.log.debug('Unhandled event type', { type: data.type, data });
          return null;
      }
    } catch (error) {
      this.log.warn('Failed to parse JSON line', { line, error });
      // Treat non-JSON lines as text output
      return { type: 'output', content: line };
    }
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.log.debug('Cleaning up session', { sessionId });

    try {
      if (!session.process.killed) {
        session.process.kill('SIGTERM');
        setTimeout(() => {
          if (!session.process.killed) {
            session.process.kill('SIGKILL');
          }
        }, 3000);
      }
    } catch (error) {
      this.log.error('Failed to cleanup session', { sessionId, error });
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  private async checkCLIAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('which', ['claude']);
      proc.on('exit', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  private async getCLIVersion(): Promise<string> {
    return new Promise((resolve) => {
      const proc = spawn('claude', ['--version']);
      let output = '';

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('exit', () => {
        resolve(output.trim() || 'unknown');
      });

      proc.on('error', () => {
        resolve('unknown');
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve('unknown');
      }, 5000);
    });
  }
}

interface SessionState {
  sessionId: string;
  connectionId: string;
  process: ReturnType<typeof spawn>;
  startedAt: Date;
  tokenUsage: TokenUsage;
}

// Export singleton instance
export const claudeCodeAdapter = new ClaudeCodeAdapter();
