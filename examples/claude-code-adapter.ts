/**
 * Claude Code Adapter Usage Example
 *
 * This example demonstrates how to use the Claude Code adapter
 * to execute agent tasks via the Claude CLI.
 */

import { claudeCodeAdapter, adapterRegistry } from '@/integrations';

async function main() {
  // 1. Register the adapter
  console.log('Registering Claude Code adapter...');
  adapterRegistry.register(claudeCodeAdapter);

  // 2. Connect with API key credentials
  console.log('Connecting to Claude Code...');
  const connection = await claudeCodeAdapter.connect({
    type: 'api-key',
    data: {
      key: process.env.ANTHROPIC_API_KEY || 'sk-ant-your-api-key-here',
    },
  });

  console.log(`Connected! CLI version: ${connection.metadata?.cliVersion}`);

  // 3. Define a task
  const task = {
    prompt: 'List all TypeScript files in the src/integrations directory',
    context: 'You are a helpful code analysis assistant.',
    constraints: {
      maxDuration: 60000, // 60 seconds
      allowedTools: ['Bash', 'Read', 'Glob', 'Grep'],
      blockedTools: ['Write', 'Edit'], // Safety: don't modify files
    },
  };

  // 4. Estimate cost before execution
  const estimate = claudeCodeAdapter.estimateCost(task);
  console.log('\nCost Estimate:');
  console.log(`  Input tokens: ${estimate.estimatedInputTokens}`);
  console.log(`  Output tokens: ${estimate.estimatedOutputTokens}`);
  console.log(`  Estimated cost: $${estimate.estimatedCostUsd.toFixed(4)}`);
  console.log(`  Model: ${estimate.model}`);

  // 5. Execute the task with event streaming
  console.log('\nExecuting task...\n');

  let outputText = '';
  for await (const event of claudeCodeAdapter.execute(connection, task, {
    timeout: 60000,
    onEvent: (evt) => {
      // Optional callback for immediate event handling
      if (evt.type === 'tool-call') {
        console.log(`  [TOOL] ${evt.tool}(${JSON.stringify(evt.args)})`);
      }
    },
  })) {
    switch (event.type) {
      case 'started':
        console.log('[STARTED] Execution began');
        break;

      case 'thinking':
        if (event.content) {
          console.log(`[THINKING] ${event.content}`);
        }
        break;

      case 'output':
        outputText += event.content;
        process.stdout.write(event.content);
        break;

      case 'completed':
        console.log('\n\n[COMPLETED] Task finished successfully');
        console.log('Final output:', event.result.output);
        console.log('Metadata:', event.result.metadata);
        break;

      case 'error':
        console.error('\n[ERROR]', event.error.message);
        break;

      case 'cost':
        console.log('\n[COST] Token usage:');
        console.log(`  Input: ${event.usage.inputTokens}`);
        console.log(`  Output: ${event.usage.outputTokens}`);
        console.log(`  Total: ${event.usage.totalTokens}`);
        break;
    }
  }

  // 6. Disconnect when done
  console.log('\nDisconnecting...');
  await claudeCodeAdapter.disconnect(connection);
  console.log('Done!');
}

// Run the example
main().catch((error) => {
  console.error('Example failed:', error);
  process.exit(1);
});
