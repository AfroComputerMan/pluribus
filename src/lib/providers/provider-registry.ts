import type { AgentProvider } from "@/lib/providers/types";

// ---------------------------------------------------------------------------
// ProviderRegistry — maps model IDs to AgentProvider instances
// ---------------------------------------------------------------------------

export class ProviderRegistry {
  private readonly modelToProvider = new Map<string, AgentProvider>();
  private readonly providers: AgentProvider[] = [];

  /**
   * Register a provider. All model IDs in `provider.supportedModels` are
   * mapped to this provider for O(1) lookups.
   */
  register(provider: AgentProvider): void {
    this.providers.push(provider);
    for (const modelId of provider.supportedModels) {
      this.modelToProvider.set(modelId, provider);
    }
  }

  /**
   * Look up the provider that handles a given model ID.
   * Throws if no provider is registered for the model.
   */
  getProviderForModel(modelId: string): AgentProvider {
    const provider = this.modelToProvider.get(modelId);
    if (!provider) {
      throw new Error(
        `No provider registered for model "${modelId}". ` +
          `Available models: ${[...this.modelToProvider.keys()].join(", ")}`,
      );
    }
    return provider;
  }

  /** Return all registered providers. */
  getAllProviders(): AgentProvider[] {
    return [...this.providers];
  }

  /** Return a flat list of all available models with their providers. */
  getAvailableModels(): Array<{ modelId: string; provider: AgentProvider }> {
    const result: Array<{ modelId: string; provider: AgentProvider }> = [];
    for (const [modelId, provider] of this.modelToProvider) {
      result.push({ modelId, provider });
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry();
}
