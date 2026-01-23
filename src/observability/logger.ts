import type { LogEntry, LogLevel } from './types';

// Structured logger
class Logger {
  private source: string;
  private minLevel: LogLevel;
  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(source: string, minLevel: LogLevel = 'info') {
    this.source = source;
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel];
  }

  private formatEntry(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = entry.level.toUpperCase().padEnd(5);
    const source = entry.source.padEnd(20);
    let line = `[${timestamp}] ${level} ${source} ${entry.message}`;

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      line += ` ${JSON.stringify(entry.metadata)}`;
    }

    return line;
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      source: this.source,
      message,
      metadata,
    };

    // Console output
    const formatted = this.formatEntry(entry);
    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }

    // TODO: Also store in database via observability service
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.log('info', message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log('warn', message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.log('error', message, metadata);
  }

  // Create a child logger with additional context
  child(additionalSource: string): Logger {
    return new Logger(`${this.source}:${additionalSource}`, this.minLevel);
  }

  // Set correlation IDs for request tracing
  withContext(context: {
    workflowRunId?: string;
    agentId?: string;
    nodeExecutionId?: string;
  }): ContextLogger {
    return new ContextLogger(this, context);
  }
}

// Logger with correlation context
class ContextLogger {
  constructor(
    private logger: Logger,
    private context: {
      workflowRunId?: string;
      agentId?: string;
      nodeExecutionId?: string;
    }
  ) {}

  private merge(metadata?: Record<string, unknown>): Record<string, unknown> {
    return {
      ...this.context,
      ...metadata,
    };
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.logger.debug(message, this.merge(metadata));
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.logger.info(message, this.merge(metadata));
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.logger.warn(message, this.merge(metadata));
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.logger.error(message, this.merge(metadata));
  }
}

// Create the default logger
const defaultLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
export const logger = new Logger('pluribus', defaultLevel);

// Factory function for module loggers
export function createLogger(source: string): Logger {
  return new Logger(source, defaultLevel);
}
