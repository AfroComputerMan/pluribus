import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewSessionDialog } from './NewSessionDialog';

// Mock settings store
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: any) => any) =>
    selector({
      model: 'sonnet',
      autonomyLevel: 'supervised',
    }),
}));

// Mock IPC commands
const mockListProjects = vi.fn();
const mockOpenProject = vi.fn();

vi.mock('@/ipc/commands', () => ({
  projectCommands: {
    list: (...args: any[]) => mockListProjects(...args),
    open: (...args: any[]) => mockOpenProject(...args),
  },
}));

const mockOnClose = vi.fn();
const mockOnSubmit = vi.fn();

function renderDialog(isOpen = true) {
  return render(
    <NewSessionDialog
      isOpen={isOpen}
      onClose={mockOnClose}
      onSubmit={mockOnSubmit}
    />,
  );
}

describe('NewSessionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProjects.mockResolvedValue([]);
  });

  test('does not render when closed', () => {
    const { container } = renderDialog(false);
    expect(container.innerHTML).toBe('');
  });

  test('renders form fields when open', async () => {
    renderDialog();
    expect(screen.getByText('New Session')).toBeInTheDocument();
    expect(screen.getByText('Session Name')).toBeInTheDocument();
    expect(screen.getByText('Project')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Autonomy Level')).toBeInTheDocument();
    expect(screen.getByText('Use worktree')).toBeInTheDocument();
    expect(screen.getByText('Budget Limit (USD)')).toBeInTheDocument();
    expect(screen.getByText('Max Turns')).toBeInTheDocument();
  });

  test('loads projects on open', async () => {
    const projects = [
      { id: 'p1', name: 'ProjectA', path: '/tmp/a', defaultModel: 'sonnet', defaultAutonomy: 'supervised', createdAt: '2026-01-01' },
    ];
    mockListProjects.mockResolvedValue(projects);
    renderDialog();

    await waitFor(() => {
      expect(mockListProjects).toHaveBeenCalled();
    });

    // Project should appear in dropdown
    await waitFor(() => {
      expect(screen.getByText(/ProjectA/)).toBeInTheDocument();
    });
  });

  test('submits with selected project id', async () => {
    const user = userEvent.setup();
    const projects = [
      { id: 'p1', name: 'ProjectA', path: '/tmp/a', defaultModel: 'sonnet', defaultAutonomy: 'supervised', createdAt: '2026-01-01' },
    ];
    mockListProjects.mockResolvedValue(projects);
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText(/ProjectA/)).toBeInTheDocument();
    });

    // Select the project - it's the first combobox (project dropdown)
    const selects = screen.getAllByRole('combobox');
    const projectSelect = selects[0];
    await user.selectOptions(projectSelect, 'p1');

    // Submit
    await user.click(screen.getByRole('button', { name: /create session/i }));

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        model: 'sonnet',
        autonomyLevel: 'supervised',
        useWorktree: true,
      }),
    );
    expect(mockOnClose).toHaveBeenCalled();
  });

  test('opens new project from path input', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValue([]);
    mockOpenProject.mockResolvedValue({
      id: 'p-new',
      name: 'NewProject',
      path: '/tmp/new',
      defaultModel: 'sonnet',
      defaultAutonomy: 'supervised',
      createdAt: '2026-02-08',
    });

    renderDialog();

    const pathInput = screen.getByPlaceholderText(/enter a new project path/i);
    await user.type(pathInput, '/tmp/new');
    await user.click(screen.getByRole('button', { name: /open/i }));

    await waitFor(() => {
      expect(mockOpenProject).toHaveBeenCalledWith('/tmp/new');
    });

    // New project should appear in the dropdown and be selected
    await waitFor(() => {
      expect(screen.getByText(/NewProject/)).toBeInTheDocument();
    });
  });

  test('shows error when open project fails', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValue([]);
    mockOpenProject.mockRejectedValue(new Error('Not a git repo'));

    renderDialog();

    const pathInput = screen.getByPlaceholderText(/enter a new project path/i);
    await user.type(pathInput, '/tmp/bad');
    await user.click(screen.getByRole('button', { name: /open/i }));

    await waitFor(() => {
      expect(screen.getByText('Not a git repo')).toBeInTheDocument();
    });
  });

  test('model selection changes value', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValue([]);
    renderDialog();

    // The model select - find the one with Sonnet/Opus/Haiku options
    const selects = screen.getAllByRole('combobox');
    const modelSelect = selects.find((s) => {
      const options = s.querySelectorAll('option');
      return Array.from(options).some((o) => o.textContent === 'Opus');
    });
    expect(modelSelect).toBeTruthy();

    await user.selectOptions(modelSelect!, 'opus');
    await user.click(screen.getByRole('button', { name: /create session/i }));

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'opus' }),
    );
  });

  test('autonomy level radio changes value', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValue([]);
    renderDialog();

    await user.click(screen.getByLabelText('Autonomous'));
    await user.click(screen.getByRole('button', { name: /create session/i }));

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ autonomyLevel: 'autonomous' }),
    );
  });

  test('worktree toggle changes value', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValue([]);
    renderDialog();

    // Default is checked
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: /create session/i }));

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ useWorktree: false }),
    );
  });

  test('budget and max turns are optional', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValue([]);
    renderDialog();

    await user.click(screen.getByRole('button', { name: /create session/i }));

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        maxBudgetUsd: undefined,
        maxTurns: undefined,
      }),
    );
  });

  test('budget and max turns pass numeric values', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValue([]);
    renderDialog();

    // There are two "Optional" placeholder inputs; budget is the first, max turns is the second
    const numberInputs = screen.getAllByPlaceholderText('Optional');
    await user.type(numberInputs[0], '5.50');
    await user.type(numberInputs[1], '10');

    await user.click(screen.getByRole('button', { name: /create session/i }));

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        maxBudgetUsd: 5.5,
        maxTurns: 10,
      }),
    );
  });

  test('cancel button calls onClose', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValue([]);
    renderDialog();

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockOnClose).toHaveBeenCalled();
  });
});
