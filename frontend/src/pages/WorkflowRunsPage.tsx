import { useParams } from 'react-router-dom';

export function WorkflowRunsPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Workflow Runs</h1>
      <div className="bg-white shadow rounded-lg p-6">
        <p className="text-gray-600">Runs for workflow {id} will be displayed here.</p>
      </div>
    </div>
  );
}
