export interface SessionConfig {
  model: string;
  autonomyLevel: 'ask' | 'supervised' | 'autonomous';
  useWorktree: boolean;
  baseBranch?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  systemPromptAppend?: string;
  allowedTools?: string[];
}

export interface SessionSummary {
  id: string;
  projectId: string;
  name: string;
  status: import('./chat').SessionStatus;
  claudeSessionId?: string;
  model: string;
  autonomyLevel: string;
  worktreePath?: string;
  worktreeBranch?: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  turnCount: number;
  createdAt: string;
}
