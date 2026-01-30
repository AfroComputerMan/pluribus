/**
 * InputMappingEditor
 * Editor for workflow node input mappings
 * Supports both static string values and node output references
 */

import { useState } from 'react';
import type { WorkflowNode } from '../../../stores/workflowBuilderStore';
import type { InputMapping } from '../../../lib/validation/nodeSchemas';

interface InputMappingEditorProps {
  value: InputMapping;
  onChange: (value: InputMapping) => void;
  availableNodes: WorkflowNode[];
  disabled?: boolean;
}

interface MappingEntry {
  key: string;
  value: string | { fromNode: string; path: string };
  isReference: boolean;
}

export function InputMappingEditor({
  value,
  onChange,
  availableNodes,
  disabled = false,
}: InputMappingEditorProps) {
  // Convert object to array for easier manipulation
  const entries: MappingEntry[] = Object.entries(value).map(([key, val]) => ({
    key,
    value: val,
    isReference: typeof val === 'object' && val !== null && 'fromNode' in val,
  }));

  const handleKeyChange = (oldKey: string, newKey: string) => {
    const newValue = { ...value };
    if (oldKey !== newKey) {
      newValue[newKey] = newValue[oldKey];
      delete newValue[oldKey];
    }
    onChange(newValue);
  };

  const handleValueChange = (key: string, newVal: string | { fromNode: string; path: string }) => {
    onChange({ ...value, [key]: newVal });
  };

  const handleRemove = (key: string) => {
    const newValue = { ...value };
    delete newValue[key];
    onChange(newValue);
  };

  const handleAdd = () => {
    const newKey = `input_${Date.now()}`;
    onChange({ ...value, [newKey]: '' });
  };

  const toggleReference = (key: string, isCurrentlyReference: boolean) => {
    if (isCurrentlyReference) {
      // Convert to static
      onChange({ ...value, [key]: '' });
    } else {
      // Convert to reference
      onChange({ ...value, [key]: { fromNode: '', path: '' } });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">Input Mappings</label>
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled}
          className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
          aria-label="Add input"
        >
          + Add Input
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No input mappings defined</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <MappingRow
              key={entry.key}
              entry={entry}
              availableNodes={availableNodes}
              disabled={disabled}
              onKeyChange={(newKey) => handleKeyChange(entry.key, newKey)}
              onValueChange={(newVal) => handleValueChange(entry.key, newVal)}
              onRemove={() => handleRemove(entry.key)}
              onToggleReference={() => toggleReference(entry.key, entry.isReference)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface MappingRowProps {
  entry: MappingEntry;
  availableNodes: WorkflowNode[];
  disabled: boolean;
  onKeyChange: (newKey: string) => void;
  onValueChange: (newVal: string | { fromNode: string; path: string }) => void;
  onRemove: () => void;
  onToggleReference: () => void;
}

function MappingRow({
  entry,
  availableNodes,
  disabled,
  onKeyChange,
  onValueChange,
  onRemove,
  onToggleReference,
}: MappingRowProps) {
  const [localKey, setLocalKey] = useState(entry.key);

  const handleKeyBlur = () => {
    if (localKey !== entry.key && localKey.trim()) {
      onKeyChange(localKey.trim());
    }
  };

  return (
    <div className="flex gap-2 items-start p-2 bg-gray-50 rounded border border-gray-200">
      {/* Key input */}
      <div className="w-1/4">
        <input
          type="text"
          value={localKey}
          onChange={(e) => setLocalKey(e.target.value)}
          onBlur={handleKeyBlur}
          disabled={disabled}
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="key"
        />
      </div>

      {/* Value input - either static or reference */}
      <div className="flex-1">
        {entry.isReference ? (
          <ReferenceValueInput
            value={entry.value as { fromNode: string; path: string }}
            availableNodes={availableNodes}
            disabled={disabled}
            onChange={onValueChange}
          />
        ) : (
          <input
            type="text"
            value={entry.value as string}
            onChange={(e) => onValueChange(e.target.value)}
            disabled={disabled}
            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="value"
          />
        )}
      </div>

      {/* Toggle button */}
      <button
        type="button"
        onClick={onToggleReference}
        disabled={disabled}
        className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-50"
        aria-label={entry.isReference ? 'Static' : 'Reference'}
      >
        {entry.isReference ? 'Static' : 'Reference'}
      </button>

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="px-2 py-1 text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
        aria-label="Remove"
      >
        Remove
      </button>
    </div>
  );
}

interface ReferenceValueInputProps {
  value: { fromNode: string; path: string };
  availableNodes: WorkflowNode[];
  disabled: boolean;
  onChange: (value: { fromNode: string; path: string }) => void;
}

function ReferenceValueInput({
  value,
  availableNodes,
  disabled,
  onChange,
}: ReferenceValueInputProps) {
  return (
    <div className="flex gap-2">
      <select
        value={value.fromNode}
        onChange={(e) => onChange({ ...value, fromNode: e.target.value })}
        disabled={disabled}
        className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">Select node...</option>
        {availableNodes.map((node) => (
          <option key={node.id} value={node.id}>
            {String(node.data.label || node.id)}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={value.path}
        onChange={(e) => onChange({ ...value, path: e.target.value })}
        disabled={disabled}
        className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        placeholder="output.path"
      />
    </div>
  );
}
