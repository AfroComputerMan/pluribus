import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { WorkflowRunsPage } from './pages/WorkflowRunsPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { WorkflowBuilderPage } from './pages/WorkflowBuilderPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5000,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<WorkflowsPage />} />
            <Route path="workflows/:id/runs" element={<WorkflowRunsPage />} />
            <Route path="runs/:id" element={<RunDetailPage />} />
          </Route>
          {/* Workflow Builder - Full screen layout */}
          <Route path="workflows/new" element={<WorkflowBuilderPage />} />
          <Route path="workflows/:id/edit" element={<WorkflowBuilderPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
