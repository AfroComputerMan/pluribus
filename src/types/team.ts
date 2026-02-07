export interface Team {
  id: string;
  projectId: string;
  name: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  claudeTeamDir?: string;
  createdAt: string;
}

export interface TeamAgent {
  id: string;
  name: string;
  sessionId?: string;
  status: 'idle' | 'working' | 'completed' | 'failed';
  currentTask?: string;
}

export interface TeamTask {
  id: string;
  teamId: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  assignedAgent?: string;
  dependencies?: string[];
  filePath?: string;
  createdAt: string;
}
