import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createLogger, logger } from '@/observability/logger';

describe('Logger', () => {
  let consoleLogSpy: ReturnType<typeof mock>;
  let consoleWarnSpy: ReturnType<typeof mock>;
  let consoleErrorSpy: ReturnType<typeof mock>;

  beforeEach(() => {
    consoleLogSpy = mock(() => {});
    consoleWarnSpy = mock(() => {});
    consoleErrorSpy = mock(() => {});
    console.log = consoleLogSpy;
    console.warn = consoleWarnSpy;
    console.error = consoleErrorSpy;
  });

  afterEach(() => {
    // Restore original console methods
    consoleLogSpy.mockRestore?.();
    consoleWarnSpy.mockRestore?.();
    consoleErrorSpy.mockRestore?.();
  });

  describe('log levels', () => {
    test('info logs to console.log', () => {
      logger.info('Test info message');

      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain('INFO');
      expect(call).toContain('Test info message');
    });

    test('warn logs to console.warn', () => {
      logger.warn('Test warning message');

      expect(consoleWarnSpy).toHaveBeenCalled();
      const call = consoleWarnSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain('WARN');
      expect(call).toContain('Test warning message');
    });

    test('error logs to console.error', () => {
      logger.error('Test error message');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain('ERROR');
      expect(call).toContain('Test error message');
    });
  });

  describe('metadata', () => {
    test('includes metadata in log output', () => {
      logger.info('Message with metadata', { userId: '123', action: 'login' });

      const call = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain('userId');
      expect(call).toContain('123');
      expect(call).toContain('action');
      expect(call).toContain('login');
    });

    test('handles undefined metadata', () => {
      logger.info('Message without metadata');

      const call = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain('Message without metadata');
    });

    test('handles empty metadata object', () => {
      logger.info('Message with empty metadata', {});

      const call = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain('Message with empty metadata');
    });
  });

  describe('child logger', () => {
    test('creates child with combined source', () => {
      const childLogger = logger.child('agents:service');

      childLogger.info('Child log message');

      const call = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain('pluribus:agents:service');
    });

    test('child can create grandchild', () => {
      const childLogger = logger.child('agents').child('repository');

      childLogger.info('Grandchild log message');

      const call = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain('pluribus:agents:repository');
    });
  });

  describe('context logger', () => {
    test('includes workflow run ID in all logs', () => {
      const contextLogger = logger.withContext({ workflowRunId: 'wf-run-123' });

      contextLogger.info('Workflow started');

      const call = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain('workflowRunId');
      expect(call).toContain('wf-run-123');
    });

    test('includes agent ID in all logs', () => {
      const contextLogger = logger.withContext({ agentId: 'agent-456' });

      contextLogger.info('Agent executing');

      const call = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain('agentId');
      expect(call).toContain('agent-456');
    });

    test('merges context with additional metadata', () => {
      const contextLogger = logger.withContext({
        workflowRunId: 'wf-123',
        agentId: 'agent-456',
      });

      contextLogger.info('Operation complete', { duration: 1500 });

      const call = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain('workflowRunId');
      expect(call).toContain('agentId');
      expect(call).toContain('duration');
      expect(call).toContain('1500');
    });

    test('context logger supports all log levels', () => {
      const contextLogger = logger.withContext({ nodeExecutionId: 'node-789' });

      contextLogger.debug('Debug');
      contextLogger.info('Info');
      contextLogger.warn('Warn');
      contextLogger.error('Error');

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('createLogger factory', () => {
    test('creates logger with custom source', () => {
      const customLogger = createLogger('my-module');

      customLogger.info('Custom module log');

      const call = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain('my-module');
    });
  });

  describe('log format', () => {
    test('includes timestamp in ISO format', () => {
      logger.info('Timestamped message');

      const call = consoleLogSpy.mock.calls[0]?.[0] as string;
      // Should contain ISO timestamp pattern
      expect(call).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('pads log level to 5 characters', () => {
      logger.info('Info message');
      logger.warn('Warn message');

      // Both INFO and WARN  should be padded
      const infoCall = consoleLogSpy.mock.calls[0]?.[0] as string;
      const warnCall = consoleWarnSpy.mock.calls[0]?.[0] as string;

      expect(infoCall).toContain('INFO ');
      expect(warnCall).toContain('WARN ');
    });
  });
});
