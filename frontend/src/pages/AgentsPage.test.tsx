/**
 * AgentsPage Tests
 * TDD: Write tests first, then implement
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AgentsPage } from './AgentsPage';
import { api } from '../api/client';
import type { Agent } from '../api/client';

// Mock the API client
vi.mock('../api/client', () => ({
  api: {
    agents: {
      list: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as any;

// Component that displays when navigated
function CreateAgentPage() {
  return <div data-testid="create-agent-page">Create Agent Page</div>;
}

function EditAgentPage() {
  return <div data-testid="edit-agent-page">Edit Agent Page</div>;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents']}>
          <Routes>
            <Route path="/agents" element={children} />
            <Route path="/agents/new" element={<CreateAgentPage />} />
            <Route path="/agents/:id/edit" element={<EditAgentPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

const mockAgents: Agent[] = [
  {
    id: '123e4567-e89b-12d3-a456-426614174001',
    name: 'Code Assistant',
    description: 'An AI coding assistant',
    tags: ['coding', 'ai'],
    modelConfig: { provider: 'anthropic', model: 'claude-3-opus' },
    memoryMode: 'stateless',
    isolationLevel: 'shared',
    canSpawnSubAgents: false,
    maxSubAgents: null,
    skills: [],
    allowedMcpTools: [],
    integration: { type: 'claude-code', connectionId: '123e4567-e89b-12d3-a456-426614174099' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: '123e4567-e89b-12d3-a456-426614174002',
    name: 'Research Agent',
    description: 'Helps with research tasks',
    tags: ['research'],
    modelConfig: { provider: 'openai', model: 'gpt-4' },
    memoryMode: 'session',
    isolationLevel: 'container',
    canSpawnSubAgents: true,
    maxSubAgents: 3,
    skills: [],
    allowedMcpTools: [],
    integration: null,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
];

describe('AgentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    mockApi.agents.list.mockReturnValue(new Promise(() => {})); // Never resolves

    render(<AgentsPage />, { wrapper: createWrapper() });

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders error state', async () => {
    mockApi.agents.list.mockRejectedValue(new Error('Network error'));

    render(<AgentsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });

  it('renders agents list', async () => {
    mockApi.agents.list.mockResolvedValue({
      data: mockAgents,
      meta: { limit: 50, offset: 0 },
    });

    render(<AgentsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Code Assistant')).toBeInTheDocument();
      expect(screen.getByText('Research Agent')).toBeInTheDocument();
    });
  });

  it('displays agent model and integration info', async () => {
    mockApi.agents.list.mockResolvedValue({
      data: mockAgents,
      meta: { limit: 50, offset: 0 },
    });

    render(<AgentsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('claude-3-opus')).toBeInTheDocument();
      expect(screen.getByText('gpt-4')).toBeInTheDocument();
      expect(screen.getByText('claude-code')).toBeInTheDocument();
    });
  });

  it('displays agent tags', async () => {
    mockApi.agents.list.mockResolvedValue({
      data: mockAgents,
      meta: { limit: 50, offset: 0 },
    });

    render(<AgentsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('coding')).toBeInTheDocument();
      expect(screen.getByText('ai')).toBeInTheDocument();
      expect(screen.getByText('research')).toBeInTheDocument();
    });
  });

  it('renders create agent button', async () => {
    mockApi.agents.list.mockResolvedValue({
      data: [],
      meta: { limit: 50, offset: 0 },
    });

    render(<AgentsPage />, { wrapper: createWrapper() });

    // Wait for loading to complete, then check for button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create agent/i })).toBeInTheDocument();
    });
  });

  it('navigates to create page on button click', async () => {
    mockApi.agents.list.mockResolvedValue({
      data: [],
      meta: { limit: 50, offset: 0 },
    });

    render(<AgentsPage />, { wrapper: createWrapper() });

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create agent/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /create agent/i }));

    await waitFor(() => {
      expect(screen.getByTestId('create-agent-page')).toBeInTheDocument();
    });
  });

  it('filters agents by search term', async () => {
    mockApi.agents.list.mockResolvedValue({
      data: mockAgents,
      meta: { limit: 50, offset: 0 },
    });

    render(<AgentsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Code Assistant')).toBeInTheDocument();
      expect(screen.getByText('Research Agent')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search agents/i);
    fireEvent.change(searchInput, { target: { value: 'code' } });

    expect(screen.getByText('Code Assistant')).toBeInTheDocument();
    expect(screen.queryByText('Research Agent')).not.toBeInTheDocument();
  });

  it('shows empty message when no agents', async () => {
    mockApi.agents.list.mockResolvedValue({
      data: [],
      meta: { limit: 50, offset: 0 },
    });

    render(<AgentsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/no agents found/i)).toBeInTheDocument();
    });
  });

  it('navigates to edit page on row click', async () => {
    mockApi.agents.list.mockResolvedValue({
      data: mockAgents,
      meta: { limit: 50, offset: 0 },
    });

    render(<AgentsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Code Assistant')).toBeInTheDocument();
    });

    // Click on the agent row (the name cell)
    fireEvent.click(screen.getByText('Code Assistant'));

    await waitFor(() => {
      expect(screen.getByTestId('edit-agent-page')).toBeInTheDocument();
    });
  });

  it('has delete button for each agent', async () => {
    mockApi.agents.list.mockResolvedValue({
      data: mockAgents,
      meta: { limit: 50, offset: 0 },
    });

    render(<AgentsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      expect(deleteButtons).toHaveLength(2);
    });
  });

  it('calls delete API when confirmed', async () => {
    mockApi.agents.list.mockResolvedValue({
      data: mockAgents,
      meta: { limit: 50, offset: 0 },
    });
    mockApi.agents.delete.mockResolvedValue(undefined);

    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AgentsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Code Assistant')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mockApi.agents.delete).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174001');
    });
  });

  it('does not delete when not confirmed', async () => {
    mockApi.agents.list.mockResolvedValue({
      data: mockAgents,
      meta: { limit: 50, offset: 0 },
    });

    // Mock window.confirm to return false
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<AgentsPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Code Assistant')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    expect(mockApi.agents.delete).not.toHaveBeenCalled();
  });
});
