import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSSE } from './useSSE'

// Mock EventSource class
class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  close = vi.fn()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  // Helper to simulate events
  simulateOpen() {
    this.onopen?.({} as Event)
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent)
  }

  simulateError() {
    this.onerror?.({} as Event)
  }
}

describe('useSSE', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not create EventSource when url is null', () => {
    renderHook(() => useSSE(null))

    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('does not create EventSource when disabled', () => {
    renderHook(() => useSSE('/api/events', { enabled: false }))

    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('creates EventSource with correct URL', () => {
    renderHook(() => useSSE('/api/events'))

    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toBe('/api/events')
  })

  it('starts disconnected', () => {
    const { result } = renderHook(() => useSSE('/api/events'))

    expect(result.current.isConnected).toBe(false)
  })

  it('sets isConnected to true on open', async () => {
    const { result } = renderHook(() => useSSE('/api/events'))

    act(() => {
      MockEventSource.instances[0].simulateOpen()
    })

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
    })
  })

  it('calls onOpen callback', () => {
    const onOpen = vi.fn()
    renderHook(() => useSSE('/api/events', { onOpen }))

    act(() => {
      MockEventSource.instances[0].simulateOpen()
    })

    expect(onOpen).toHaveBeenCalled()
  })

  it('calls onMessage callback on message', () => {
    const onMessage = vi.fn()
    renderHook(() => useSSE('/api/events', { onMessage }))

    act(() => {
      MockEventSource.instances[0].simulateMessage('test data')
    })

    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ data: 'test data' }))
  })

  it('sets error on connection error', async () => {
    const { result } = renderHook(() => useSSE('/api/events'))

    act(() => {
      MockEventSource.instances[0].simulateError()
    })

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error)
      expect(result.current.error?.message).toBe('SSE connection error')
    })
  })

  it('sets isConnected to false on error', async () => {
    const { result } = renderHook(() => useSSE('/api/events'))

    // First connect
    act(() => {
      MockEventSource.instances[0].simulateOpen()
    })

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
    })

    // Then error
    act(() => {
      MockEventSource.instances[0].simulateError()
    })

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false)
    })
  })

  it('calls onError callback', () => {
    const onError = vi.fn()
    renderHook(() => useSSE('/api/events', { onError }))

    act(() => {
      MockEventSource.instances[0].simulateError()
    })

    expect(onError).toHaveBeenCalled()
  })

  it('closes EventSource on unmount', () => {
    const { unmount } = renderHook(() => useSSE('/api/events'))
    const instance = MockEventSource.instances[0]

    unmount()

    expect(instance.close).toHaveBeenCalled()
  })

  it('close function closes the connection', async () => {
    const { result } = renderHook(() => useSSE('/api/events'))
    const instance = MockEventSource.instances[0]

    act(() => {
      instance.simulateOpen()
    })

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
    })

    act(() => {
      result.current.close()
    })

    expect(instance.close).toHaveBeenCalled()
    expect(result.current.isConnected).toBe(false)
  })

  it('clears error on successful reconnect', async () => {
    const { result } = renderHook(() => useSSE('/api/events'))
    const instance = MockEventSource.instances[0]

    // First error
    act(() => {
      instance.simulateError()
    })

    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    // Then reconnect
    act(() => {
      instance.simulateOpen()
    })

    await waitFor(() => {
      expect(result.current.error).toBeNull()
    })
  })
})
