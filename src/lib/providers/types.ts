import type { ChatModelRunResult } from "@assistant-ui/react";

// Re-export for convenience
export type { ChatModelRunResult };

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------

export interface ProviderCapabilities {
  readonly supportsResume: boolean;
  readonly supportsApproval: boolean;
  readonly supportsSubAgents: boolean;
  readonly supportsMcp: boolean;
  readonly supportsEffort: boolean;
}

// ---------------------------------------------------------------------------
// Dev events
// ---------------------------------------------------------------------------

export interface DevEvent {
  readonly category: string;
  readonly data: unknown;
  readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Run context — passed to AgentProvider.run()
// ---------------------------------------------------------------------------

export interface RunContext {
  readonly prompt: string;
  readonly sessionId: string | null;
  readonly model: string;
  readonly cwd: string;
  readonly effort: string | null;
  readonly abortSignal: AbortSignal;
  readonly threadId: string;
  readonly onDevEvent?: (event: DevEvent) => void;
  /** Called by the provider when the underlying process PID is known. */
  readonly onProcessStarted?: (pid: number) => void;
}

// ---------------------------------------------------------------------------
// Agent provider interface
// ---------------------------------------------------------------------------

export interface AgentProvider {
  readonly id: "agent-sdk" | "codex" | "pi";
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  readonly supportedModels: string[];

  run(ctx: RunContext): AsyncGenerator<ChatModelRunResult, void>;
  interrupt(threadId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Active process row (mirrors active_processes SQLite table)
// ---------------------------------------------------------------------------

export interface ActiveProcess {
  readonly id: string;
  readonly provider: string;
  readonly pid: number;
  readonly thread_id: string | null;
  readonly spawned_at: string;
}
