# TypeScript & Testing Patterns

**Created**: 2026-02-01
**Context**: Fixing frontend build errors and test compatibility issues

---

## Type Compatibility with Index Signatures

### Problem
When a type has an index signature (`[key: string]: unknown`), any type being assigned to it must also satisfy that signature. TypeScript can't verify that object literals with specific properties satisfy an index signature.

### Example
```typescript
// In api/client.ts
export interface BackendNode {
  id: string;
  type: string;
  [key: string]: unknown;  // Index signature for flexibility
}

// In serialization.ts - THIS FAILS:
interface LocalBackendNode {
  id: string;
  type: string;
  agentId?: string;  // No index signature!
}

const node: BackendNode = { id: '1', type: 'agent' };  // Error!
```

### Solution
1. **Reuse types from canonical source** - Import from `api/client.ts` rather than redefining
2. **Add explicit return type annotations** - Help TypeScript understand the mapping
3. **Use type assertions when needed** - `as BackendNode` for object literals

```typescript
// CORRECT: Import from canonical source
import type { BackendNode, BackendEdge } from '@/api/client';

// CORRECT: Explicit return type annotation
const backendNodes: BackendNode[] = nodes.map((node): BackendNode => ({
  id: node.id,
  type: node.type,
  ...nodeSpecificProps,
}));
```

---

## Zod API Version Changes

### Problem
Zod 4.x changed the error customization API for `z.enum()`.

### Migration
```typescript
// OLD (Zod 3.x) - deprecated
z.enum(['a', 'b', 'c'], {
  errorMap: () => ({ message: 'Must be a, b, or c' }),
})

// NEW (Zod 4.x)
z.enum(['a', 'b', 'c'], {
  message: 'Must be a, b, or c',
})
```

---

## Test Environment: Bun Test vs Vitest

### Problem
`bun test` uses Bun's built-in test runner, which has different module resolution than Vitest. Path aliases (`@/`), environment settings, and setup files from `vitest.config.ts` are ignored.

### Symptoms
- `Cannot find module '@/api/client'`
- `document is not defined`
- `global is not defined`

### Solution
**Always use `bun run test`** (not `bun test`) when the project uses Vitest.

```bash
# WRONG - uses Bun's test runner, ignores vitest.config.ts
bun test

# CORRECT - uses Vitest with full configuration
bun run test
bun run test --run  # CI mode (no watch)
```

The package.json script `"test": "vitest"` ensures proper configuration loading.

---

## Global vs GlobalThis

### Problem
`global` is Node.js-specific. In browser/universal environments, `globalThis` should be used.

### Migration
```typescript
// OLD - Node.js only
global.ResizeObserver = vi.fn()...

// NEW - Universal
globalThis.ResizeObserver = vi.fn()... as unknown as typeof ResizeObserver
```

---

## TypeScript Union Type Narrowing

### Problem
When a function returns a union type, TypeScript requires explicit narrowing before accessing type-specific properties.

### Example
```typescript
type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; errors: Array<...> };

// WRONG - TypeScript can't know which variant we have
const result = validateNodeConfig('agent', {});
expect(result.error).toBeDefined();  // Error: 'error' doesn't exist on success case

// CORRECT - Narrow first
const result = validateNodeConfig('agent', {});
expect(result.success).toBe(false);
if (!result.success) {
  expect(result.error).toBeDefined();  // OK - narrowed to error case
}
```

---

## Test Mock Completeness

### Problem
When mocking API responses, partial objects cause TypeScript errors if the type has required fields.

### Solution
Create helper functions that return complete mock objects:

```typescript
// Helper with all required fields and sensible defaults
function createMockWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'test-id',
    name: 'Test Workflow',
    description: null,
    nodes: [],
    edges: [],
    triggers: [{ type: 'manual' }],
    errorStrategy: { retries: 0, onFailure: 'stop' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// Usage in tests
const mockWorkflow = createMockWorkflow({ id: 'custom-id' });
vi.mocked(api.workflows.create).mockResolvedValue({ data: mockWorkflow });
```

---

## React Flow Mock Typing

### Problem
When mocking `@xyflow/react`, loose typing like `Record<string, unknown>` causes issues when rendering values as `ReactNode`.

### Solution
Define explicit interfaces for mock data:

```typescript
// Define types for mock data
interface MockNodeData {
  label?: string;
  executionStatus?: string;
  duration?: string;
}

interface MockNode {
  id: string;
  data: MockNodeData;
}

// Use in mock
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes }: { nodes: MockNode[] }) => (
    <div>
      {nodes.map((node) => (
        <div key={node.id}>{node.data.label}</div>  // Now typed correctly
      ))}
    </div>
  ),
}));
```

---

## Summary Checklist

When fixing TypeScript/test issues:

- [ ] Check for duplicate type definitions - consolidate to one source
- [ ] Verify Zod API matches installed version
- [ ] Use `bun run test` not `bun test` for Vitest projects
- [ ] Use `globalThis` instead of `global` for browser compatibility
- [ ] Add type narrowing before accessing union-specific properties
- [ ] Create complete mock objects with helper functions
- [ ] Use explicit types in test mocks to avoid `unknown` → `ReactNode` issues
