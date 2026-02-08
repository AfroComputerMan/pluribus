import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionSidebar } from './SessionSidebar';
import type { SessionSummary } from '@/types/session';

// Track mock store state and functions
const mockSetActiveSession = vi.fn();
const mockAddSession = vi.fn();

let mockSessions: SessionSummary[] = [];
let mockActiveSessionId: string | null = null;

vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: (selector: (state: any) => any) =>
    selector({
      sessions: mockSessions,
      activeSessionId: mockActiveSessionId,
      setActiveSession: mockSetActiveSession,
      addSession: mockAddSession,
    }),
}));

// Mock IPC commands
vi.mock('@/ipc/commands', () => ({
  sessionCommands: {
    create: vi.fn(),
  },
}));

// Mock child components
vi.mock('./SessionItem', () => ({
  SessionItem: ({ session, isActive, onClick }: any) => (
    <button
      data-testid={`session-${session.id}`}
      data-active={isActive}
      onClick={onClick}
    >
      {session.name}
    </button>
  ),
}));

vi.mock('./NewSessionDialog', () => ({
  NewSessionDialog: ({ isOpen }: any) =>
    isOpen ? <div data-testid="new-session-dialog">Dialog</div> : null,
}));

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'Test Session',
    status: 'created',
    model: 'sonnet',
    autonomyLevel: 'supervised',
    totalCostUsd: 0.5,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    turnCount: 3,
    createdAt: '2026-02-08T12:00:00Z',
    ...overrides,
  };
}

describe('SessionSidebar', () => {
  beforeEach(() => {
    mockSessions = [];
    mockActiveSessionId = null;
    mockSetActiveSession.mockReset();
    mockAddSession.mockReset();
  });

  test('shows empty state when no sessions', () => {
    render(<SessionSidebar />);
    expect(screen.getByText(/No sessions yet/)).toBeInTheDocument();
  });

  test('lists sessions from store', () => {
    mockSessions = [
      makeSession({ id: 's1', name: 'Alpha' }),
      makeSession({ id: 's2', name: 'Beta' }),
    ];
    render(<SessionSidebar />);

    expect(screen.getByTestId('session-s1')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByTestId('session-s2')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  test('active session is marked', () => {
    mockSessions = [
      makeSession({ id: 's1', name: 'Alpha' }),
      makeSession({ id: 's2', name: 'Beta' }),
    ];
    mockActiveSessionId = 's2';
    render(<SessionSidebar />);

    expect(screen.getByTestId('session-s1').dataset.active).toBe('false');
    expect(screen.getByTestId('session-s2').dataset.active).toBe('true');
  });

  test('clicking session calls setActiveSession', async () => {
    const user = userEvent.setup();
    mockSessions = [makeSession({ id: 's1', name: 'Alpha' })];
    render(<SessionSidebar />);

    await user.click(screen.getByTestId('session-s1'));
    expect(mockSetActiveSession).toHaveBeenCalledWith('s1');
  });

  test('new session button is present with correct label', () => {
    render(<SessionSidebar />);
    expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
  });

  test('clicking new session button opens dialog', async () => {
    const user = userEvent.setup();
    render(<SessionSidebar />);

    expect(screen.queryByTestId('new-session-dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /new session/i }));
    expect(screen.getByTestId('new-session-dialog')).toBeInTheDocument();
  });

  test('sessions are sorted by createdAt descending', () => {
    mockSessions = [
      makeSession({ id: 's1', name: 'Older', createdAt: '2026-02-07T10:00:00Z' }),
      makeSession({ id: 's2', name: 'Newer', createdAt: '2026-02-08T10:00:00Z' }),
    ];
    render(<SessionSidebar />);

    const buttons = screen.getAllByTestId(/^session-/);
    // Newer should come first (sorted desc by createdAt)
    expect(buttons[0].dataset.testid).toBe('session-s2');
    expect(buttons[1].dataset.testid).toBe('session-s1');
  });

  test('header displays "Sessions" title', () => {
    render(<SessionSidebar />);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });
});
