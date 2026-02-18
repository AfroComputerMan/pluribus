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

export const CLAUDE_MODELS: ClaudeModel[] = [
  { id: "claude-opus-4-6",   alias: "opus",   label: "Opus 4.6",   family: "4.6", supportsEffort: true },
  { id: "claude-sonnet-4-6", alias: "sonnet", label: "Sonnet 4.6", family: "4.6", supportsEffort: true },
  { id: "claude-haiku-4-5",  alias: "haiku",  label: "Haiku 4.5",  family: "4.5", supportsEffort: false },
];

export type EffortLevel = "low" | "medium" | "high";

export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high"];

export const DEFAULT_MODEL_ID = "claude-opus-4-6";
export const DEFAULT_EFFORT: EffortLevel = "high";

/** Lookup a model by its full ID. Returns `undefined` if not found. */
export function getModelById(id: string): ClaudeModel | undefined {
  return CLAUDE_MODELS.find((m) => m.id === id);
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
  if (threadEffort && EFFORT_LEVELS.includes(threadEffort as EffortLevel))
    return threadEffort as EffortLevel;
  const stored = localStorage.getItem("pluribus:lastEffort");
  if (stored && EFFORT_LEVELS.includes(stored as EffortLevel))
    return stored as EffortLevel;
  return DEFAULT_EFFORT;
}
