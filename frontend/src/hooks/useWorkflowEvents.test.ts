import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkflowEvents, type WorkflowEvent } from './useWorkflowEvents'
import { useSSE } from './useSSE'

// Mock useSSE
vi.mock('./useSSE', () => ({
  useSSE: vi.fn(),
}))

const mockUseSSE = useSSE as Mock

describe('useWorkflowEvents', () => {
  let capturedOnMessage: ((event: MessageEvent) => void) | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnMessage = undefined

    // Default mock implementation
    mockUseSSE.mockImplementation((_url: string | null, options?: { onMessage?: (event: MessageEvent) => void }) => {
      capturedOnMessage = options?.onMessage
      return {
        isConnected: false,
        error: null,
        close: vi.fn(),
      }
    })
  })

  it('builds correct SSE URL from runId', () => {
    renderHook(() => useWorkflowEvents('run-123'))

    expect(mockUseSSE).toHaveBeenCalledWith(
      '/api/runs/run-123/events',
      expect.any(Object)
    )
  })

  it('passes null URL when runId is undefined', () => {
    renderHook(() => useWorkflowEvents(undefined))

    expect(mockUseSSE).toHaveBeenCalledWith(null, expect.any(Object))
  })

  it('starts with empty events', () => {
    const { result } = renderHook(() => useWorkflowEvents('run-123'))

    expect(result.current.events).toEqual([])
    expect(result.current.latestEvent).toBeNull()
  })

  it('parses and stores incoming events', () => {
    const { result } = renderHook(() => useWorkflowEvents('run-123'))

    const eventData: WorkflowEvent = {
      type: 'node.started',
      timestamp: '2026-01-30T10:00:00Z',
      data: { nodeId: 'node-1' },
    }

    act(() => {
      capturedOnMessage?.({ data: JSON.stringify(eventData) } as MessageEvent)
    })

    expect(result.current.events).toHaveLength(1)
    expect(result.current.events[0]).toEqual(eventData)
    expect(result.current.latestEvent).toEqual(eventData)
  })

  it('accumulates multiple events', () => {
    const { result } = renderHook(() => useWorkflowEvents('run-123'))

    const event1: WorkflowEvent = {
      type: 'node.started',
      timestamp: '2026-01-30T10:00:00Z',
      data: { nodeId: 'node-1' },
    }
    const event2: WorkflowEvent = {
      type: 'node.completed',
      timestamp: '2026-01-30T10:00:05Z',
      data: { nodeId: 'node-1' },
    }

    act(() => {
      capturedOnMessage?.({ data: JSON.stringify(event1) } as MessageEvent)
      capturedOnMessage?.({ data: JSON.stringify(event2) } as MessageEvent)
    })

    expect(result.current.events).toHaveLength(2)
    expect(result.current.latestEvent).toEqual(event2)
  })

  it('calls onEvent callback for each event', () => {
    const onEvent = vi.fn()
    renderHook(() => useWorkflowEvents('run-123', { onEvent }))

    const eventData: WorkflowEvent = {
      type: 'workflow.completed',
      timestamp: '2026-01-30T10:00:00Z',
      data: {},
    }

    act(() => {
      capturedOnMessage?.({ data: JSON.stringify(eventData) } as MessageEvent)
    })

    expect(onEvent).toHaveBeenCalledWith(eventData)
  })

  it('handles invalid JSON gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useWorkflowEvents('run-123'))

    act(() => {
      capturedOnMessage?.({ data: 'invalid json' } as MessageEvent)
    })

    expect(result.current.events).toHaveLength(0)
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('resets events when runId changes', () => {
    const { result, rerender } = renderHook(
      ({ runId }) => useWorkflowEvents(runId),
      { initialProps: { runId: 'run-1' } }
    )

    const eventData: WorkflowEvent = {
      type: 'node.started',
      timestamp: '2026-01-30T10:00:00Z',
      data: {},
    }

    act(() => {
      capturedOnMessage?.({ data: JSON.stringify(eventData) } as MessageEvent)
    })

    expect(result.current.events).toHaveLength(1)

    // Change runId
    rerender({ runId: 'run-2' })

    expect(result.current.events).toHaveLength(0)
    expect(result.current.latestEvent).toBeNull()
  })

  it('exposes isConnected from useSSE', () => {
    mockUseSSE.mockReturnValue({
      isConnected: true,
      error: null,
      close: vi.fn(),
    })

    const { result } = renderHook(() => useWorkflowEvents('run-123'))

    expect(result.current.isConnected).toBe(true)
  })

  it('exposes error from useSSE', () => {
    const error = new Error('Connection failed')
    mockUseSSE.mockReturnValue({
      isConnected: false,
      error,
      close: vi.fn(),
    })

    const { result } = renderHook(() => useWorkflowEvents('run-123'))

    expect(result.current.error).toBe(error)
  })

  it('exposes close function from useSSE', () => {
    const closeFn = vi.fn()
    mockUseSSE.mockReturnValue({
      isConnected: true,
      error: null,
      close: closeFn,
    })

    const { result } = renderHook(() => useWorkflowEvents('run-123'))

    result.current.close()

    expect(closeFn).toHaveBeenCalled()
  })

  it('respects enabled option', () => {
    renderHook(() => useWorkflowEvents('run-123', { enabled: false }))

    expect(mockUseSSE).toHaveBeenCalledWith(
      '/api/runs/run-123/events',
      expect.objectContaining({ enabled: false })
    )
  })
})
