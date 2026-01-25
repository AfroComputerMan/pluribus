export * from './types';
export { adapterRegistry, getAdapter } from './registry';
export * from './adapters';

// Initialize adapters on module load
import { claudeCodeAdapter } from './adapters/claude-code';
import { adapterRegistry } from './registry';

// Register all adapters
adapterRegistry.register(claudeCodeAdapter);
