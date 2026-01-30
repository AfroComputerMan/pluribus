/**
 * ResourceLimitsEditor
 * Editor for Docker container resource limits
 */

import type { ResourceLimits } from '../../../lib/validation/nodeSchemas';

interface ResourceLimitsEditorProps {
  value: ResourceLimits;
  onChange: (value: ResourceLimits) => void;
  disabled?: boolean;
}

export function ResourceLimitsEditor({
  value,
  onChange,
  disabled = false,
}: ResourceLimitsEditorProps) {
  const handleChange = (field: keyof ResourceLimits, rawValue: string) => {
    const numValue = rawValue === '' ? undefined : Number(rawValue);
    onChange({ ...value, [field]: numValue });
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-gray-700">Resource Limits</h4>

      {/* Memory */}
      <div>
        <label htmlFor="memoryMB" className="block text-sm text-gray-600 mb-1">
          Memory <span className="text-gray-400">(MB)</span>
        </label>
        <input
          id="memoryMB"
          type="number"
          value={value.memoryMB ?? ''}
          onChange={(e) => handleChange('memoryMB', e.target.value)}
          disabled={disabled}
          min="1"
          max="8192"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          placeholder="512"
        />
        <p className="mt-1 text-xs text-gray-400">Max: 8192 MB (8GB)</p>
      </div>

      {/* CPU Shares */}
      <div>
        <label htmlFor="cpuShares" className="block text-sm text-gray-600 mb-1">
          CPU Shares
        </label>
        <input
          id="cpuShares"
          type="number"
          value={value.cpuShares ?? ''}
          onChange={(e) => handleChange('cpuShares', e.target.value)}
          disabled={disabled}
          min="1"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          placeholder="1024"
        />
        <p className="mt-1 text-xs text-gray-400">Relative weight (default: 1024)</p>
      </div>

      {/* Timeout */}
      <div>
        <label htmlFor="timeoutSeconds" className="block text-sm text-gray-600 mb-1">
          Timeout <span className="text-gray-400">(seconds)</span>
        </label>
        <input
          id="timeoutSeconds"
          type="number"
          value={value.timeoutSeconds ?? ''}
          onChange={(e) => handleChange('timeoutSeconds', e.target.value)}
          disabled={disabled}
          min="1"
          max="86400"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          placeholder="300"
        />
        <p className="mt-1 text-xs text-gray-400">Max: 86400 seconds (24 hours)</p>
      </div>
    </div>
  );
}
