/**
 * API Client for Pluribus Backend
 * Provides type-safe wrapper around fetch with error handling
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(
    message: string,
    status: number,
    data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

async function apiFetch<T>(
  endpoint: string,
  options: FetchOptions = {},
): Promise<T> {
  const { params, ...fetchOptions } = options;

  // Build URL with query parameters
  let url = `${API_BASE_URL}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  // Set default headers
  const headers = new Headers(fetchOptions.headers);
  if (!headers.has('Content-Type') && fetchOptions.body) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...fetchOptions,
    headers,
  });

  // Handle non-OK responses
  if (!response.ok) {
    let errorData: unknown;
    const contentType = response.headers.get('Content-Type');

    try {
      if (contentType?.includes('application/json')) {
        errorData = await response.json();
      } else {
        errorData = await response.text();
      }
    } catch {
      errorData = null;
    }

    throw new ApiError(
      `API Error: ${response.status} ${response.statusText}`,
      response.status,
      errorData,
    );
  }

  // Parse response
  const contentType = response.headers.get('Content-Type');
  if (contentType?.includes('application/json')) {
    return response.json();
  }

  return response.text() as T;
}

// API Types (subset - expand as needed)
export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  definition: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  definition: Record<string, unknown>;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  definition?: Record<string, unknown>;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NodeRun {
  id: string;
  workflowRunId: string;
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListResponse<T> {
  data: T[];
  meta: {
    limit: number;
    offset: number;
  };
}

export interface DataResponse<T> {
  data: T;
}

// API Methods
export const api = {
  // Workflows
  workflows: {
    list: (params?: { limit?: number; offset?: number }) =>
      apiFetch<ListResponse<Workflow>>('/workflows', { params }),

    get: (id: string) =>
      apiFetch<DataResponse<Workflow>>(`/workflows/${id}`),

    create: (input: CreateWorkflowInput) =>
      apiFetch<DataResponse<Workflow>>('/workflows', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    update: (id: string, input: UpdateWorkflowInput) =>
      apiFetch<DataResponse<Workflow>>(`/workflows/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),

    delete: (id: string) =>
      apiFetch<void>(`/workflows/${id}`, {
        method: 'DELETE',
      }),
  },

  // Workflow Runs
  workflowRuns: {
    list: (workflowId: string, params?: { limit?: number; offset?: number }) =>
      apiFetch<ListResponse<WorkflowRun>>(`/workflows/${workflowId}/runs`, { params }),

    get: (id: string) =>
      apiFetch<DataResponse<WorkflowRun>>(`/runs/${id}`),

    create: (workflowId: string, input: Record<string, unknown>) =>
      apiFetch<DataResponse<WorkflowRun>>(`/workflows/${workflowId}/run`, {
        method: 'POST',
        body: JSON.stringify({ input }),
      }),

    retry: (id: string) =>
      apiFetch<DataResponse<WorkflowRun>>(`/runs/${id}/retry`, {
        method: 'POST',
      }),

    cancel: (id: string) =>
      apiFetch<DataResponse<WorkflowRun>>(`/runs/${id}/cancel`, {
        method: 'POST',
      }),

    /**
     * Create EventSource connection for SSE workflow events
     * Use with useWorkflowEvents hook for React integration
     */
    streamEvents: (runId: string): EventSource => {
      const url = `${API_BASE_URL}/runs/${runId}/events`;
      return new EventSource(url);
    },
  },

  // Node Runs
  nodeRuns: {
    list: (workflowRunId: string) =>
      apiFetch<DataResponse<NodeRun[]>>(`/runs/${workflowRunId}/nodes`),
  },
};
