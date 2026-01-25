import { useParams } from 'react-router-dom';

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Run Detail</h1>
      <div className="bg-white shadow rounded-lg p-6">
        <p className="text-gray-600">Details for run {id} will be displayed here.</p>
      </div>
    </div>
  );
}
