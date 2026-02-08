import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/common';
import { useProjects } from '@/hooks/useProjects';

export function ProjectsPage() {
  const { projects, loading, error, openProject } = useProjects();
  const [newPath, setNewPath] = useState('');
  const [openError, setOpenError] = useState('');

  const handleOpen = async () => {
    if (!newPath.trim()) return;
    setOpenError('');
    try {
      await openProject(newPath.trim());
      setNewPath('');
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  };

  const inputClass = 'flex-1 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <AppShell>
      <div className="flex-1 h-full overflow-y-auto p-6 max-w-2xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Projects
        </h1>

        {/* Open New Project */}
        <div className="mb-6">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Open a Project
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="Enter path to a git repository..."
              className={inputClass}
              onKeyDown={(e) => { if (e.key === 'Enter') handleOpen(); }}
            />
            <Button onClick={handleOpen} disabled={!newPath.trim()}>
              Open
            </Button>
          </div>
          {openError && (
            <p className="mt-1 text-xs text-red-500">{openError}</p>
          )}
        </div>

        {/* Project List */}
        {error && (
          <p className="text-sm text-red-500 mb-4">{error}</p>
        )}

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading projects...</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No projects yet. Open a git repository above to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {projects.map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
              >
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {project.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {project.path}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-medium">
                    {project.defaultModel}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
