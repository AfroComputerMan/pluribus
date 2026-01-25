import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createLogger } from '@/observability/logger';

const logger = createLogger('mcp:transport');

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface IMCPTransport extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: JSONRPCRequest | JSONRPCNotification): Promise<void>;
  isConnected(): boolean;
}

/**
 * StdioTransport - Communicates with MCP server via child process stdin/stdout
 */
export class StdioTransport extends EventEmitter implements IMCPTransport {
  private process?: ReturnType<typeof spawn>;
  private connected = false;
  private buffer = '';

  constructor(
    private command: string,
    private args: string[] = [],
    private cwd?: string
  ) {
    super();
  }

  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error('Already connected');
    }

    logger.info('Connecting to MCP server via stdio', {
      command: this.command,
      args: this.args,
    });

    this.process = spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      logger.warn('MCP server stderr', { data: chunk.toString() });
    });

    this.process.on('error', (error) => {
      logger.error('MCP server process error', { error: error.message });
      this.emit('error', error);
    });

    this.process.on('exit', (code, signal) => {
      logger.info('MCP server process exited', { code, signal });
      this.connected = false;
      this.emit('disconnect');
    });

    this.connected = true;
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as JSONRPCResponse;
          this.emit('message', message);
        } catch (error) {
          logger.error('Failed to parse JSON-RPC message', { line, error });
        }
      }
    }
  }

  async send(message: JSONRPCRequest | JSONRPCNotification): Promise<void> {
    if (!this.connected || !this.process?.stdin) {
      throw new Error('Not connected');
    }

    const line = `${JSON.stringify(message)}\n`;
    this.process.stdin.write(line);
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = undefined;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * HttpTransport - Communicates with MCP server via HTTP POST requests
 */
export class HttpTransport extends EventEmitter implements IMCPTransport {
  private connected = false;

  constructor(private url: string) {
    super();
  }

  async connect(): Promise<void> {
    logger.info('Connecting to MCP server via HTTP', { url: this.url });

    // Test connection with a ping
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          method: 'ping',
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.connected = true;
    } catch (error) {
      logger.error('Failed to connect to MCP server', { error });
      throw error;
    }
  }

  async send(message: JSONRPCRequest | JSONRPCNotification): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if ('id' in message) {
      const result = (await response.json()) as JSONRPCResponse;
      this.emit('message', result);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * WebSocketTransport - Communicates with MCP server via WebSocket
 */
export class WebSocketTransport extends EventEmitter implements IMCPTransport {
  private ws?: WebSocket;
  private connected = false;

  constructor(private url: string) {
    super();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('Connecting to MCP server via WebSocket', { url: this.url });

      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.connected = true;
        logger.info('WebSocket connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as JSONRPCResponse;
          this.emit('message', message);
        } catch (error) {
          logger.error('Failed to parse WebSocket message', { error });
        }
      };

      this.ws.onerror = (error) => {
        logger.error('WebSocket error', { error });
        this.emit('error', error);
        reject(error);
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.emit('disconnect');
      };
    });
  }

  async send(message: JSONRPCRequest | JSONRPCNotification): Promise<void> {
    if (!this.connected || !this.ws) {
      throw new Error('Not connected');
    }

    this.ws.send(JSON.stringify(message));
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
