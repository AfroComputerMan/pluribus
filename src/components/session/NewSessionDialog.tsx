import { useState } from 'react';
import { Button } from '@/components/common';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CreateSessionInput } from '@/ipc/commands';

interface NewSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (config: CreateSessionInput) => void;
}

function defaultSessionName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Session ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function NewSessionDialog({ isOpen, onClose, onSubmit }: NewSessionDialogProps) {
  const defaultModel = useSettingsStore((s) => s.model);
  const defaultAutonomy = useSettingsStore((s) => s.autonomyLevel);

  const [name, setName] = useState(defaultSessionName);
  const [projectPath, setProjectPath] = useState('');
  const [model, setModel] = useState<string>(defaultModel);
  const [autonomyLevel, setAutonomyLevel] = useState<'ask' | 'supervised' | 'autonomous'>(defaultAutonomy);
  const [useWorktree, setUseWorktree] = useState(true);
  const [budgetLimit, setBudgetLimit] = useState('');
  const [maxTurns, setMaxTurns] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      projectId: projectPath || 'default',
      name,
      model,
      autonomyLevel,
      useWorktree,
      maxBudgetUsd: budgetLimit ? Number(budgetLimit) : undefined,
      maxTurns: maxTurns ? Number(maxTurns) : undefined,
    });
    onClose();
  };

  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
  const inputClass = 'w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        role="presentation"
      />
      <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          New Session
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>Session Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Project Path</label>
            <input
              type="text"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="/path/to/project"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={inputClass}
            >
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Autonomy Level</label>
            <div className="flex gap-4 mt-1">
              {(['ask', 'supervised', 'autonomous'] as const).map((level) => (
                <label key={level} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    name="autonomyLevel"
                    value={level}
                    checked={autonomyLevel === level}
                    onChange={() => setAutonomyLevel(level)}
                    className="text-blue-600"
                  />
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="useWorktree"
              checked={useWorktree}
              onChange={(e) => setUseWorktree(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="useWorktree" className="text-sm text-gray-700 dark:text-gray-300">
              Use worktree
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Budget Limit (USD)</label>
              <input
                type="number"
                value={budgetLimit}
                onChange={(e) => setBudgetLimit(e.target.value)}
                placeholder="Optional"
                min="0"
                step="0.01"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Max Turns</label>
              <input
                type="number"
                value={maxTurns}
                onChange={(e) => setMaxTurns(e.target.value)}
                placeholder="Optional"
                min="1"
                step="1"
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Create Session
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
