# Integration Adapters

This directory contains adapter implementations for different AI agent platforms.

## Claude Code Adapter

The Claude Code adapter provides integration with the Claude CLI for executing agent tasks.

### Installation

The Claude CLI must be installed and available in your system PATH:

```bash
# Install Claude CLI (see https://github.com/anthropics/claude-code)
npm install -g @anthropic-ai/claude-code
```

### Usage

```typescript
import { claudeCodeAdapter, adapterRegistry } from '@/integrations';

// Register the adapter
adapterRegistry.register(claudeCodeAdapter);

// Connect with API key credentials
const connection = await claudeCodeAdapter.connect({
  type: 'api-key',
  data: { key: 'sk-ant-your-api-key' },
});

// Execute a task
const task = {
  prompt: 'List all TypeScript files in the src directory',
  context: 'You are a code analysis assistant',
  constraints: {
    maxDuration: 60000, // 60 seconds
    allowedTools: ['Bash', 'Read', 'Glob'],
  },
};

// Stream execution events
for await (const event of claudeCodeAdapter.execute(connection, task)) {
  switch (event.type) {
    case 'started':
      console.log('Execution started');
      break;
    case 'thinking':
      console.log('Thinking:', event.content);
      break;
    case 'tool-call':
      console.log('Tool call:', event.tool, event.args);
      break;
    case 'output':
      console.log('Output:', event.content);
      break;
    case 'completed':
      console.log('Completed:', event.result);
      break;
    case 'error':
      console.error('Error:', event.error);
      break;
    case 'cost':
      console.log('Token usage:', event.usage);
      break;
  }
}

// Disconnect when done
await claudeCodeAdapter.disconnect(connection);
```

### Features

- **Process Isolation**: Spawns Claude CLI as a child process for each task
- **Stream Events**: Real-time event streaming for thinking, tool calls, and output
- **Cost Tracking**: Automatic token usage tracking and cost estimation
- **Timeout Support**: Configurable execution timeouts with graceful termination
- **Tool Constraints**: Allow/block specific tools for security and control
- **Session Management**: Automatic cleanup of processes and resources

### Event Types

The adapter emits the following event types:

- `started`: Execution has begun
- `thinking`: Claude's internal reasoning (extended thinking)
- `tool-call`: Claude is calling a tool (Read, Write, Bash, etc.)
- `tool-result`: Result from a tool execution
- `output`: Text output from Claude
- `completed`: Execution finished successfully
- `error`: An error occurred during execution
- `cost`: Token usage and cost information

### Configuration Options

#### Task Constraints

```typescript
interface TaskConstraints {
  maxTokens?: number;        // Max output tokens
  maxDuration?: number;       // Max execution time in ms
  allowedTools?: string[];    // Whitelist of allowed tools
  blockedTools?: string[];    // Blacklist of blocked tools
}
```

#### Execution Options

```typescript
interface ExecutionOptions {
  timeout?: number;                           // Execution timeout in ms
  onEvent?: (event: ExecutionEvent) => void;  // Event callback
}
```

### Pricing

The adapter includes built-in pricing for Claude models (USD per 1M tokens):

- **Claude Sonnet 4.5** (2025-09-29): $3.00 input / $15.00 output
- **Claude Opus 4.5** (2025-11-01): $15.00 input / $75.00 output
- **Claude Sonnet 3.5** (2024-10-22): $3.00 input / $15.00 output
- **Claude Haiku 3.5** (2024-10-22): $0.80 input / $4.00 output

### Error Handling

The adapter provides specific error types:

- `CredentialError`: Invalid or missing API key
- `IntegrationError`: CLI not found or execution failed

```typescript
try {
  const connection = await claudeCodeAdapter.connect(credentials);
} catch (error) {
  if (error instanceof CredentialError) {
    console.error('Invalid API key');
  } else if (error instanceof IntegrationError) {
    console.error('Claude CLI not installed');
  }
}
```

### Integration with Runtime

The adapter works seamlessly with the runtime execution system:

```typescript
import { claudeCodeAdapter } from '@/integrations';
import { ProcessIsolationStrategy } from '@/runtime/strategies/process';

const runtimeTask = {
  id: 'task-1',
  adapter: claudeCodeAdapter,
  connection: myConnection,
  task: myAgentTask,
  timeout: 60000,
};

// Execute through runtime manager
const runtime = new ProcessIsolationStrategy();
for await (const event of runtime.execute(runtimeTask)) {
  // Handle events
}
```

## Future Adapters

This directory will be extended with additional adapters:

- **Codex Adapter**: OpenAI Codex integration
- **OpenCode Adapter**: Open-source code models
- **Local Bridge Adapter**: Local model execution
- **Custom Adapter**: User-defined custom integrations
