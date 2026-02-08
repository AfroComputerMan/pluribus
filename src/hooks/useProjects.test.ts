import { describe, expect, test, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProjects } from './useProjects';

const mockList = vi.fn();
const mockOpen = vi.fn();

vi.mock('@/ipc/commands', () => ({
  projectCommands: {
    list: (...args: any[]) => mockList(...args),
    open: (...args: any[]) => mockOpen(...args),
  },
}));

const fakeProject = {
  id: 'p1',
  name: 'TestProject',
  path: '/tmp/test',
  defaultModel: 'sonnet',
  defaultAutonomy: 'supervised',
  createdAt: '2026-02-08',
};

describe('useProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
  });

  test('loads projects on mount', async () => {
    mockList.mockResolvedValue([fakeProject]);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects).toEqual([fakeProject]);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  test('handles load error', async () => {
    mockList.mockRejectedValue(new Error('DB error'));

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.error).toBe('DB error');
    });
    expect(result.current.projects).toEqual([]);
  });

  test('openProject adds to list', async () => {
    mockList.mockResolvedValue([]);
    mockOpen.mockResolvedValue(fakeProject);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      const project = await result.current.openProject('/tmp/test');
      expect(project).toEqual(fakeProject);
    });

    expect(result.current.projects).toEqual([fakeProject]);
  });

  test('openProject deduplicates existing project', async () => {
    mockList.mockResolvedValue([fakeProject]);
    const updatedProject = { ...fakeProject, name: 'UpdatedName' };
    mockOpen.mockResolvedValue(updatedProject);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects).toHaveLength(1);
    });

    await act(async () => {
      await result.current.openProject('/tmp/test');
    });

    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0].name).toBe('UpdatedName');
  });
});
