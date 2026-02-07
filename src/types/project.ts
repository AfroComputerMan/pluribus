export interface Project {
  id: string;
  name: string;
  path: string;
  defaultModel: string;
  defaultAutonomy: string;
  createdAt: string;
}

export interface ProjectSettings {
  defaultModel: string;
  defaultAutonomy: string;
}
