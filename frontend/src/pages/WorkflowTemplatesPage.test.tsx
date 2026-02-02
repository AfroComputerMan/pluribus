/**
 * WorkflowTemplatesPage Tests
 * Tests for workflow template selection and loading
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { WorkflowTemplatesPage } from './WorkflowTemplatesPage';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/templates']}>
        <Routes>
          <Route path="/templates" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('WorkflowTemplatesPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useWorkflowBuilderStore.getState().reset();
  });

  describe('Template List', () => {
    it('renders page title', () => {
      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      expect(screen.getByText('Workflow Templates')).toBeInTheDocument();
    });

    it('displays all available templates', () => {
      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      // Should show at least 5 templates as per plan
      expect(screen.getByText('Simple Agent Pipeline')).toBeInTheDocument();
      expect(screen.getByText('Conditional Routing')).toBeInTheDocument();
      expect(screen.getByText('Parallel Processing')).toBeInTheDocument();
      expect(screen.getByText('Review Workflow')).toBeInTheDocument();
      expect(screen.getByText('Data Processing Loop')).toBeInTheDocument();
    });

    it('shows template descriptions', () => {
      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      expect(
        screen.getByText(/sequential chain of agents/i),
      ).toBeInTheDocument();
    });

    it('shows node count for each template', () => {
      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      // Each template card should show node count
      const nodeCountTexts = screen.getAllByText(/\d+ nodes/i);
      expect(nodeCountTexts.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Template Selection', () => {
    it('loads template into store when "Use Template" is clicked', async () => {
      const user = userEvent.setup();
      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      const useButton = screen.getAllByRole('button', { name: /use template/i })[0];
      await user.click(useButton);

      // Verify store was updated with template data
      const state = useWorkflowBuilderStore.getState();
      expect(state.nodes.length).toBeGreaterThan(0);
    });

    it('navigates to workflow builder after selecting template', async () => {
      const user = userEvent.setup();
      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      const useButton = screen.getAllByRole('button', { name: /use template/i })[0];
      await user.click(useButton);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/workflows/new');
      });
    });

    it('sets workflow name from template', async () => {
      const user = userEvent.setup();
      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      const useButton = screen.getAllByRole('button', { name: /use template/i })[0];
      await user.click(useButton);

      const state = useWorkflowBuilderStore.getState();
      expect(state.workflowName).toContain('Pipeline');
    });
  });

  describe('Template Preview', () => {
    it('shows preview when "Preview" is clicked', async () => {
      const user = userEvent.setup();
      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      const previewButton = screen.getAllByRole('button', { name: /preview/i })[0];
      await user.click(previewButton);

      // Preview modal should appear
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('shows node list in preview', async () => {
      const user = userEvent.setup();
      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      const previewButton = screen.getAllByRole('button', { name: /preview/i })[0];
      await user.click(previewButton);

      await waitFor(() => {
        // Preview should show node count heading
        expect(screen.getByText(/Nodes \(\d+\)/)).toBeInTheDocument();
      });
    });

    it('closes preview when close button clicked', async () => {
      const user = userEvent.setup();
      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      const previewButton = screen.getAllByRole('button', { name: /preview/i })[0];
      await user.click(previewButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Get the Close button inside the modal (there's also an X icon button with aria-label="Close")
      const modal = screen.getByRole('dialog');
      const closeButton = modal.querySelector('button[aria-label="Close"]') ||
                          Array.from(modal.querySelectorAll('button')).find(btn => btn.textContent === 'Close');
      await user.click(closeButton!);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });
  });

  describe('Empty Start Option', () => {
    it('provides option to start with blank canvas', async () => {
      const user = userEvent.setup();
      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      const blankButton = screen.getByRole('button', { name: /start from scratch/i });
      await user.click(blankButton);

      expect(mockNavigate).toHaveBeenCalledWith('/workflows/new');
    });

    it('does not load any template when starting blank', async () => {
      const user = userEvent.setup();

      // Pre-populate store to ensure it gets cleared
      useWorkflowBuilderStore.getState().addNode({
        id: 'existing',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: {},
      });

      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      const blankButton = screen.getByRole('button', { name: /start from scratch/i });
      await user.click(blankButton);

      const state = useWorkflowBuilderStore.getState();
      expect(state.nodes).toHaveLength(0);
    });
  });

  describe('Search/Filter', () => {
    it('filters templates by search term', async () => {
      const user = userEvent.setup();
      render(<WorkflowTemplatesPage />, { wrapper: createWrapper() });

      const searchInput = screen.getByPlaceholderText(/search templates/i);
      await user.type(searchInput, 'parallel');

      await waitFor(() => {
        expect(screen.getByText('Parallel Processing')).toBeInTheDocument();
        expect(screen.queryByText('Simple Agent Pipeline')).not.toBeInTheDocument();
      });
    });
  });
});
