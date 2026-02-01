import { useState } from 'react';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore';
import type { WorkflowTrigger } from '@/api/client';

export function WorkflowMetadataForm() {
  const {
    workflowName,
    workflowDescription,
    triggers,
    errorStrategy,
    setWorkflowName,
    setWorkflowDescription,
    setTriggers,
    setErrorStrategy,
  } = useWorkflowBuilderStore();

  const [isTriggersExpanded, setIsTriggersExpanded] = useState(false);
  const [isErrorStrategyExpanded, setIsErrorStrategyExpanded] = useState(false);

  // Check if a trigger type is enabled
  const hasTrigger = (type: WorkflowTrigger['type']) =>
    triggers.some((t) => t.type === type);

  // Get a specific trigger
  const getTrigger = <T extends WorkflowTrigger['type']>(type: T) =>
    triggers.find((t) => t.type === type) as Extract<WorkflowTrigger, { type: T }> | undefined;

  // Toggle a trigger on/off
  const toggleTrigger = (type: WorkflowTrigger['type']) => {
    if (type === 'manual') return; // Manual is always enabled

    if (hasTrigger(type)) {
      // Remove the trigger
      setTriggers(triggers.filter((t) => t.type !== type));
    } else {
      // Add the trigger with defaults
      let newTrigger: WorkflowTrigger;
      switch (type) {
        case 'schedule':
          newTrigger = { type: 'schedule', cron: '0 0 * * *' };
          break;
        case 'webhook':
          newTrigger = { type: 'webhook', secret: generateSecret() };
          break;
        case 'api':
          newTrigger = { type: 'api' };
          break;
        default:
          return;
      }
      setTriggers([...triggers, newTrigger]);
    }
  };

  // Update cron expression for schedule trigger
  const updateCron = (cron: string) => {
    setTriggers(
      triggers.map((t) =>
        t.type === 'schedule' ? { ...t, cron } : t
      )
    );
  };

  return (
    <div className="space-y-4 p-4">
      {/* Name and Description */}
      <div className="space-y-3">
        <div>
          <label htmlFor="workflow-name" className="block text-sm font-medium text-gray-700 mb-1">
            Workflow Name
          </label>
          <input
            id="workflow-name"
            type="text"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter workflow name"
          />
        </div>

        <div>
          <label htmlFor="workflow-description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="workflow-description"
            value={workflowDescription}
            onChange={(e) => setWorkflowDescription(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Optional description"
            rows={3}
          />
        </div>
      </div>

      {/* Triggers Section */}
      <div className="border border-gray-200 rounded-md">
        <button
          type="button"
          onClick={() => setIsTriggersExpanded(!isTriggersExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          aria-expanded={isTriggersExpanded}
        >
          <span>Triggers</span>
          <span className="text-gray-400">{isTriggersExpanded ? '−' : '+'}</span>
        </button>

        {isTriggersExpanded && (
          <div className="px-4 pb-4 space-y-3 border-t border-gray-200">
            {/* Manual Trigger (always enabled) */}
            <div className="flex items-center gap-2 pt-3">
              <input
                type="checkbox"
                id="trigger-manual"
                checked={true}
                disabled
                className="h-4 w-4 text-blue-600 rounded"
              />
              <label htmlFor="trigger-manual" className="text-sm text-gray-700">
                Manual
              </label>
              <span className="text-xs text-gray-500">(always enabled)</span>
            </div>

            {/* Schedule Trigger */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="trigger-schedule"
                  checked={hasTrigger('schedule')}
                  onChange={() => toggleTrigger('schedule')}
                  className="h-4 w-4 text-blue-600 rounded"
                />
                <label htmlFor="trigger-schedule" className="text-sm text-gray-700">
                  Schedule
                </label>
              </div>
              {hasTrigger('schedule') && (
                <div className="ml-6">
                  <label htmlFor="cron-expression" className="block text-xs text-gray-600 mb-1">
                    Cron Expression
                  </label>
                  <input
                    id="cron-expression"
                    type="text"
                    value={getTrigger('schedule')?.cron || ''}
                    onChange={(e) => updateCron(e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono"
                    placeholder="0 0 * * *"
                  />
                </div>
              )}
            </div>

            {/* Webhook Trigger */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="trigger-webhook"
                  checked={hasTrigger('webhook')}
                  onChange={() => toggleTrigger('webhook')}
                  className="h-4 w-4 text-blue-600 rounded"
                />
                <label htmlFor="trigger-webhook" className="text-sm text-gray-700">
                  Webhook
                </label>
              </div>
              {hasTrigger('webhook') && (
                <div className="ml-6">
                  <span className="text-xs text-gray-600">Secret: </span>
                  <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
                    {getTrigger('webhook')?.secret}
                  </code>
                </div>
              )}
            </div>

            {/* API Trigger */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="trigger-api"
                checked={hasTrigger('api')}
                onChange={() => toggleTrigger('api')}
                className="h-4 w-4 text-blue-600 rounded"
              />
              <label htmlFor="trigger-api" className="text-sm text-gray-700">
                API
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Error Strategy Section */}
      <div className="border border-gray-200 rounded-md">
        <button
          type="button"
          onClick={() => setIsErrorStrategyExpanded(!isErrorStrategyExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          aria-expanded={isErrorStrategyExpanded}
        >
          <span>Error Strategy</span>
          <span className="text-gray-400">{isErrorStrategyExpanded ? '−' : '+'}</span>
        </button>

        {isErrorStrategyExpanded && (
          <div className="px-4 pb-4 space-y-3 border-t border-gray-200 pt-3">
            {/* Retries */}
            <div>
              <label htmlFor="error-retries" className="block text-sm text-gray-700 mb-1">
                Retries
              </label>
              <input
                id="error-retries"
                type="number"
                min={0}
                max={10}
                value={errorStrategy.retries ?? 0}
                onChange={(e) => setErrorStrategy({ retries: parseInt(e.target.value, 10) || 0 })}
                className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>

            {/* Retry Delay */}
            <div>
              <label htmlFor="error-retry-delay" className="block text-sm text-gray-700 mb-1">
                Retry Delay (ms)
              </label>
              <input
                id="error-retry-delay"
                type="number"
                min={0}
                step={1000}
                value={errorStrategy.retryDelay ?? 5000}
                onChange={(e) => setErrorStrategy({ retryDelay: parseInt(e.target.value, 10) || 0 })}
                className="w-32 border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>

            {/* On Failure */}
            <div>
              <label htmlFor="error-on-failure" className="block text-sm text-gray-700 mb-1">
                On Failure
              </label>
              <select
                id="error-on-failure"
                value={errorStrategy.onFailure ?? 'stop'}
                onChange={(e) =>
                  setErrorStrategy({
                    onFailure: e.target.value as 'stop' | 'continue' | 'human-review',
                  })
                }
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              >
                <option value="stop">Stop</option>
                <option value="continue">Continue</option>
                <option value="human-review">Human Review</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Generate a random secret for webhook triggers
function generateSecret(): string {
  return 'wh_' + Math.random().toString(36).substring(2, 15);
}
