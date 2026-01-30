/**
 * NodePalette
 * Sidebar with draggable node types
 */

const nodeTypes = [
  {
    type: 'agent',
    label: 'Agent',
    description: 'Execute an AI agent',
    color: 'blue',
    icon: '🤖',
  },
  {
    type: 'condition',
    label: 'Condition',
    description: 'Branch based on condition',
    color: 'yellow',
    icon: '🔀',
  },
  {
    type: 'parallel',
    label: 'Parallel',
    description: 'Execute multiple branches',
    color: 'purple',
    icon: '⚡',
  },
  {
    type: 'loop',
    label: 'Loop',
    description: 'Iterate over items',
    color: 'green',
    icon: '🔄',
  },
  {
    type: 'human-review',
    label: 'Human Review',
    description: 'Manual approval step',
    color: 'orange',
    icon: '👤',
  },
];

export function NodePalette() {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-4">Node Types</h2>

      <div className="space-y-2">
        {nodeTypes.map((node) => (
          <div
            key={node.type}
            draggable
            onDragStart={(e) => onDragStart(e, node.type)}
            className="p-3 bg-gray-50 border border-gray-200 rounded-lg cursor-move hover:bg-gray-100 hover:border-gray-300 transition-colors"
          >
            <div className="flex items-start gap-2">
              <div className="text-lg">{node.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2 h-2 rounded-full bg-${node.color}-500`} />
                  <div className="font-medium text-sm text-gray-900">{node.label}</div>
                </div>
                <div className="text-xs text-gray-600">{node.description}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="text-xs font-medium text-blue-900 mb-1">Tip</div>
        <div className="text-xs text-blue-700">
          Drag nodes onto the canvas and connect them to build your workflow
        </div>
      </div>
    </div>
  );
}
