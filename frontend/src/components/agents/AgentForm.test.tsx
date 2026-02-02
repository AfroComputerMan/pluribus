/**
 * AgentForm Tests
 * TDD: Write tests first, then implement
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AgentForm } from './AgentForm';
import { api } from '../../api/client';
import type { Agent } from '../../api/client';

// Mock the API client
vi.mock('../../api/client', () => ({
  api: {
    agents: {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as any;

// Placeholder for navigated page
function AgentsListPage() {
  return <div data-testid="agents-list-page">Agents List</div>;
}

function createWrapper(initialEntries: string[] = ['/agents/new']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/agents/new" element={children} />
            <Route path="/agents/:id/edit" element={children} />
            <Route path="/agents" element={<AgentsListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

const mockAgent: Agent = {
  id: '123e4567-e89b-12d3-a456-426614174001',
  name: 'Test Agent',
  description: 'A test agent description',
  tags: ['test', 'coding'],
  modelConfig: { provider: 'anthropic', model: 'claude-3-opus' },
  memoryMode: 'stateless',
  isolationLevel: 'shared',
  canSpawnSubAgents: false,
  maxSubAgents: null,
  skills: [],
  allowedMcpTools: [],
  integration: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('AgentForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create mode', () => {
    it('renders empty form for new agent', () => {
      render(<AgentForm />, { wrapper: createWrapper() });

      expect(screen.getByLabelText(/name/i)).toHaveValue('');
      expect(screen.getByLabelText(/description/i)).toHaveValue('');
    });

    it('renders form fields', () => {
      render(<AgentForm />, { wrapper: createWrapper() });

      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/model/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/provider/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/tags/i)).toBeInTheDocument();
    });

    it('renders save and cancel buttons', () => {
      render(<AgentForm />, { wrapper: createWrapper() });

      expect(screen.getByRole('button', { name: /save|create/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('validates required fields', async () => {
      render(<AgentForm />, { wrapper: createWrapper() });

      // Try to submit without filling required fields
      fireEvent.click(screen.getByRole('button', { name: /save|create/i }));

      await waitFor(() => {
        expect(screen.getByText(/name is required/i)).toBeInTheDocument();
      });
    });

    it('submits form with valid data', async () => {
      mockApi.agents.create.mockResolvedValue({ data: mockAgent });

      render(<AgentForm />, { wrapper: createWrapper() });

      // Fill in the form
      fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'New Agent' } });
      fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Description' } });
      fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'claude-3-opus' } });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /save|create/i }));

      await waitFor(() => {
        expect(mockApi.agents.create).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'New Agent',
            description: 'Description',
          }),
        );
      });
    });

    it('navigates to agents list after successful create', async () => {
      mockApi.agents.create.mockResolvedValue({ data: mockAgent });

      render(<AgentForm />, { wrapper: createWrapper() });

      fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'New Agent' } });
      fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'claude-3-opus' } });

      fireEvent.click(screen.getByRole('button', { name: /save|create/i }));

      await waitFor(() => {
        expect(screen.getByTestId('agents-list-page')).toBeInTheDocument();
      });
    });

    it('navigates back on cancel', async () => {
      render(<AgentForm />, { wrapper: createWrapper() });

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.getByTestId('agents-list-page')).toBeInTheDocument();
      });
    });
  });

  describe('edit mode', () => {
    it('loads existing agent data', async () => {
      mockApi.agents.get.mockResolvedValue({ data: mockAgent });

      render(<AgentForm />, {
        wrapper: createWrapper(['/agents/123e4567-e89b-12d3-a456-426614174001/edit']),
      });

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue('Test Agent');
        expect(screen.getByLabelText(/description/i)).toHaveValue('A test agent description');
      });
    });

    it('shows loading state while fetching', async () => {
      mockApi.agents.get.mockReturnValue(new Promise(() => {})); // Never resolves

      render(<AgentForm />, {
        wrapper: createWrapper(['/agents/123e4567-e89b-12d3-a456-426614174001/edit']),
      });

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('shows error state if fetch fails', async () => {
      mockApi.agents.get.mockRejectedValue(new Error('Failed to fetch'));

      render(<AgentForm />, {
        wrapper: createWrapper(['/agents/123e4567-e89b-12d3-a456-426614174001/edit']),
      });

      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument();
      });
    });

    it('calls update API on submit', async () => {
      mockApi.agents.get.mockResolvedValue({ data: mockAgent });
      mockApi.agents.update.mockResolvedValue({ data: { ...mockAgent, name: 'Updated Agent' } });

      render(<AgentForm />, {
        wrapper: createWrapper(['/agents/123e4567-e89b-12d3-a456-426614174001/edit']),
      });

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue('Test Agent');
      });

      fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Updated Agent' } });
      fireEvent.click(screen.getByRole('button', { name: /save|update/i }));

      await waitFor(() => {
        expect(mockApi.agents.update).toHaveBeenCalledWith(
          '123e4567-e89b-12d3-a456-426614174001',
          expect.objectContaining({
            name: 'Updated Agent',
          }),
        );
      });
    });
  });

  describe('model configuration', () => {
    it('allows selecting provider', async () => {
      render(<AgentForm />, { wrapper: createWrapper() });

      const providerSelect = screen.getByLabelText(/provider/i);
      expect(providerSelect).toBeInTheDocument();

      fireEvent.change(providerSelect, { target: { value: 'openai' } });

      expect(providerSelect).toHaveValue('openai');
    });

    it('has provider options', () => {
      render(<AgentForm />, { wrapper: createWrapper() });

      const providerSelect = screen.getByLabelText(/provider/i);

      expect(providerSelect.querySelectorAll('option').length).toBeGreaterThan(1);
    });
  });

  describe('tags input', () => {
    it('allows entering tags as comma-separated values', async () => {
      render(<AgentForm />, { wrapper: createWrapper() });

      const tagsInput = screen.getByLabelText(/tags/i);
      fireEvent.change(tagsInput, { target: { value: 'ai, coding, automation' } });

      expect(tagsInput).toHaveValue('ai, coding, automation');
    });
  });

  describe('memory mode selection', () => {
    it('allows selecting memory mode', () => {
      render(<AgentForm />, { wrapper: createWrapper() });

      const memoryModeSelect = screen.getByLabelText(/memory mode/i);
      expect(memoryModeSelect).toBeInTheDocument();

      fireEvent.change(memoryModeSelect, { target: { value: 'session' } });

      expect(memoryModeSelect).toHaveValue('session');
    });
  });

  describe('isolation level selection', () => {
    it('allows selecting isolation level', () => {
      render(<AgentForm />, { wrapper: createWrapper() });

      const isolationSelect = screen.getByLabelText(/isolation/i);
      expect(isolationSelect).toBeInTheDocument();

      fireEvent.change(isolationSelect, { target: { value: 'container' } });

      expect(isolationSelect).toHaveValue('container');
    });
  });
});
