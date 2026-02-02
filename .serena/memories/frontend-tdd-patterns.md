# Frontend TDD Patterns

## Test Setup

### Vitest Configuration
```typescript
// vite.config.ts test section
test: {
  environment: 'jsdom',
  setupFiles: ['./src/test/setup.ts'],
  globals: true,
  coverage: {
    provider: 'v8',
    thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 }
  }
}
```

### Test Setup File
```typescript
// src/test/setup.ts
import '@testing-library/jest-dom';

// Required for React Flow in jsdom
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserver;
```

## Mocking Patterns

### 1. EventSource Mock (for SSE)
```typescript
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  
  close() {}
  
  simulateOpen() { this.onopen?.({} as Event); }
  simulateMessage(data: string) { this.onmessage?.({ data } as MessageEvent); }
  simulateError() { this.onerror?.({} as Event); }
}

vi.stubGlobal('EventSource', MockEventSource);
```

### 2. React Flow Component Mock
```typescript
vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${type}-${position}${id ? `-${id}` : ''}`} />
  ),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));
```

### 3. Fetch Mock for API Tests
```typescript
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  vi.resetAllMocks();
});

// Usage
mockFetch.mockResolvedValueOnce({
  ok: true,
  headers: new Headers({ 'Content-Type': 'application/json' }),
  json: () => Promise.resolve({ data: mockData }),
});
```

### 4. Zustand Store Testing
```typescript
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';

beforeEach(() => {
  useWorkflowBuilderStore.getState().reset();
});

// Call getState() after mutations to check state
const store = useWorkflowBuilderStore.getState();
store.addNode(newNode);
expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(1);
```

## Common Test Pitfalls

### 1. Locale-Dependent Formatting
```typescript
// BAD - breaks in different locales
expect(screen.getByText('10:00:00 AM')).toBeInTheDocument();

// GOOD - query by structure
const timestamps = container.querySelectorAll('.text-gray-500.w-20');
expect(timestamps).toHaveLength(4);
```

### 2. Text Split by Markup
```typescript
// BAD - text split by <mark> element
expect(screen.getByText('Agent task failed: timeout')).toBeInTheDocument();

// GOOD - use partial match
expect(screen.getByText(/Agent task failed/)).toBeInTheDocument();
```

### 3. Async State Updates
```typescript
// Use waitFor for async updates
await waitFor(() => {
  expect(screen.getByText('Updated content')).toBeInTheDocument();
});
```

### 4. React Query Wrapper
```typescript
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/path']}>
        <Routes>
          <Route path="/path" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// Usage
render(<MyComponent />, { wrapper: createWrapper() });
```

## Test File Organization
- Co-locate tests: `Component.tsx` → `Component.test.tsx` in same directory
- One describe block per component
- Nested describe blocks for feature groups
- Clear test names: "displays X when Y"

## TDD Cycle Reminder
1. **RED**: Write failing test first
2. **GREEN**: Write minimum code to pass
3. **REFACTOR**: Clean up while tests stay green
4. Run tests after EVERY change
