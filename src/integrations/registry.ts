import type { AgentAdapter, IntegrationType } from './types';

// Adapter registry - singleton to manage all registered adapters
class AdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Adapter with id '${adapter.id}' is already registered`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  unregister(adapterId: string): boolean {
    return this.adapters.delete(adapterId);
  }

  get(adapterId: string): AgentAdapter | undefined {
    return this.adapters.get(adapterId);
  }

  getByType(type: IntegrationType): AgentAdapter[] {
    return Array.from(this.adapters.values()).filter((a) => a.type === type);
  }

  getAll(): AgentAdapter[] {
    return Array.from(this.adapters.values());
  }

  has(adapterId: string): boolean {
    return this.adapters.has(adapterId);
  }

  clear(): void {
    this.adapters.clear();
  }
}

export const adapterRegistry = new AdapterRegistry();

// Helper to get required adapter or throw
export function getAdapter(adapterId: string): AgentAdapter {
  const adapter = adapterRegistry.get(adapterId);
  if (!adapter) {
    throw new Error(`Adapter '${adapterId}' not found`);
  }
  return adapter;
}
