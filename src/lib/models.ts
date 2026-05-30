// ---------------------------------------------------------------------------
// Hardcoded model registry — update when new models ship
// ---------------------------------------------------------------------------

export interface ClaudeModel {
  /** Full model ID passed to `--model`, e.g. "claude-opus-4-6" */
  id: string;
  /** CLI alias, e.g. "opus" */
  alias: string;
  /** Human-readable label for the UI, e.g. "Opus 4.6" */
  label: string;
  /** Model family */
  family: "4.6" | "4.5";
  /** Whether the model supports `--effort` */
  supportsEffort: boolean;
}

export interface CodexModel {
  /** Full model ID passed to Codex API, e.g. "gpt-5.3-codex" */
  id: string;
  /** Human-readable label for the UI, e.g. "Codex 5.3" */
  label: string;
  /** Model family */
  family: string;
  /** Whether the model supports reasoning effort */
  supportsEffort: boolean;
}

export interface PiModel {
  /** Full model ID, provider-prefixed, e.g. "openrouter/deepseek/deepseek-v4-flash" */
  id: string;
  /** Human-readable label for the UI */
  label: string;
  /** Model family */
  family: string;
  /** Whether the model supports reasoning effort */
  supportsEffort: boolean;
}

export const CLAUDE_MODELS: ClaudeModel[] = [
  { id: "claude-opus-4-6",   alias: "opus",   label: "Opus 4.6",   family: "4.6", supportsEffort: true },
  { id: "claude-sonnet-4-6", alias: "sonnet", label: "Sonnet 4.6", family: "4.6", supportsEffort: true },
  { id: "claude-haiku-4-5",  alias: "haiku",  label: "Haiku 4.5",  family: "4.5", supportsEffort: false },
];

export const CODEX_MODELS: CodexModel[] = [
  { id: "gpt-5.3-codex",       label: "Codex 5.3",       family: "5.3", supportsEffort: true  },
  { id: "gpt-5.3-codex-spark", label: "Codex 5.3 Spark", family: "5.3", supportsEffort: false },
  { id: "gpt-5.2-codex",       label: "Codex 5.2",       family: "5.2", supportsEffort: true  },
  { id: "gpt-5.1-codex-max",   label: "Codex 5.1 Max",   family: "5.1", supportsEffort: true  },
  { id: "gpt-5.1-codex",       label: "Codex 5.1",       family: "5.1", supportsEffort: true  },
  { id: "gpt-5-codex",         label: "Codex 5",         family: "5",   supportsEffort: false },
  { id: "gpt-5-codex-mini",    label: "Codex 5 Mini",    family: "5",   supportsEffort: false },
];

export const PI_MODELS: PiModel[] = [
  {
    id: "openrouter/deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash (Pi)",
    family: "deepseek",
    supportsEffort: false,
  },
];

export type EffortLevel = "low" | "medium" | "high" | "xhigh";

/** Claude-compatible effort levels (no xhigh) */
export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high"];

/** Codex-compatible effort levels (includes xhigh) */
export const CODEX_EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh"];

/** All valid effort levels for validation */
const ALL_EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh"];

export const DEFAULT_MODEL_ID = "claude-opus-4-6";
export const DEFAULT_CODEX_MODEL_ID = "gpt-5.3-codex";
export const DEFAULT_PI_MODEL_ID = "openrouter/deepseek/deepseek-v4-flash";
export const DEFAULT_EFFORT: EffortLevel = "high";

/** Returns true if the model ID belongs to the Codex family. */
export function isCodexModel(id: string): boolean {
  return CODEX_MODELS.some((m) => m.id === id);
}

/** Returns true if the model ID belongs to the Pi family. */
export function isPiModel(id: string): boolean {
  return PI_MODELS.some((m) => m.id === id);
}

/** Lookup a model by its full ID, searching Claude, Codex, and Pi registries. */
export function getModelById(
  id: string,
): ClaudeModel | CodexModel | PiModel | undefined {
  return (
    CLAUDE_MODELS.find((m) => m.id === id) ??
    CODEX_MODELS.find((m) => m.id === id) ??
    PI_MODELS.find((m) => m.id === id)
  );
}

/** Resolve the effective model for a thread, falling back through the chain:
 *  thread row → localStorage → hardcoded default */
export function resolveModel(threadModel: string | null): string {
  if (threadModel && getModelById(threadModel)) return threadModel;
  const stored = localStorage.getItem("pluribus:lastModel");
  if (stored && getModelById(stored)) return stored;
  return DEFAULT_MODEL_ID;
}

/** Resolve the effective effort level for a thread. */
export function resolveEffort(threadEffort: string | null): EffortLevel {
  if (threadEffort && ALL_EFFORT_LEVELS.includes(threadEffort as EffortLevel))
    return threadEffort as EffortLevel;
  const stored = localStorage.getItem("pluribus:lastEffort");
  if (stored && ALL_EFFORT_LEVELS.includes(stored as EffortLevel))
    return stored as EffortLevel;
  return DEFAULT_EFFORT;
}
