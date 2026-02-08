import { useCallback, useState, useEffect } from 'react';
import { projectCommands, type Project } from '@/ipc/commands';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await projectCommands.list();
      setProjects(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const openProject = useCallback(async (path: string): Promise<Project> => {
    const project = await projectCommands.open(path);
    setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
    return project;
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return { projects, loading, error, loadProjects, openProject };
}
