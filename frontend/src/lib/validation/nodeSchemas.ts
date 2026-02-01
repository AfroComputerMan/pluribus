/**
 * Node Configuration Validation Schemas
 * Zod schemas for validating workflow node configurations
 * Aligned with backend schemas in src/core/workflows/schemas.ts
 */

import { z } from 'zod';

// ============================================================================
// Input Mapping Schema
// ============================================================================

/**
 * Schema for node input mapping values
 * Can be either a static string or a reference to another node's output
 */
const inputMappingValueSchema = z.union([
  z.string(),
  z.object({
    fromNode: z.string().min(1, 'Node ID is required'),
    path: z.string().min(1, 'Path is required'),
  }),
]);

/**
 * Schema for input mapping object
 * Maps input keys to either static values or node references
 */
export const inputMappingSchema = z.record(z.string(), inputMappingValueSchema);

export type InputMapping = z.infer<typeof inputMappingSchema>;

// ============================================================================
// Resource Limits Schema
// ============================================================================

/**
 * Schema for Docker resource limits
 * Used to constrain container resource usage
 */
export const resourceLimitsSchema = z.object({
  /** Memory limit in MB (max 8GB) */
  memoryMB: z
    .number()
    .int()
    .positive('Memory must be positive')
    .max(8192, 'Memory cannot exceed 8GB')
    .optional(),
  /** CPU shares (relative weight) */
  cpuShares: z.number().int().positive('CPU shares must be positive').optional(),
  /** Timeout in seconds */
  timeoutSeconds: z
    .number()
    .int()
    .positive('Timeout must be positive')
    .max(86400, 'Timeout cannot exceed 24 hours')
    .optional(),
});

export type ResourceLimits = z.infer<typeof resourceLimitsSchema>;

// ============================================================================
// Node Configuration Schemas
// ============================================================================

/**
 * Base schema for all node configurations
 */
const baseNodeConfigSchema = z.object({
  /** Display label for the node */
  label: z.string().optional(),
});

/**
 * Agent Node Configuration
 * Executes an AI agent with given input
 */
export const agentNodeConfigSchema = baseNodeConfigSchema.extend({
  /** UUID of the agent to execute */
  agentId: z.string().uuid('Agent ID must be a valid UUID'),
  /** Input mapping for the agent */
  input: inputMappingSchema.optional().default({}),
  /** Execution timeout in seconds */
  timeout: z.number().int().positive('Timeout must be positive').optional(),
  /** Docker resource limits */
  resourceLimits: resourceLimitsSchema.optional(),
});

export type AgentNodeConfig = z.infer<typeof agentNodeConfigSchema>;

/**
 * Condition Node Configuration
 * Branches workflow based on expression evaluation
 */
export const conditionNodeConfigSchema = baseNodeConfigSchema.extend({
  /** JavaScript expression to evaluate */
  expression: z.string().min(1, 'Expression is required'),
  /** Node ID to execute if expression is true */
  trueBranch: z.string().min(1, 'True branch is required'),
  /** Node ID to execute if expression is false */
  falseBranch: z.string().min(1, 'False branch is required'),
});

export type ConditionNodeConfig = z.infer<typeof conditionNodeConfigSchema>;

/**
 * Parallel Node Configuration
 * Executes multiple branches concurrently
 */
export const parallelNodeConfigSchema = baseNodeConfigSchema.extend({
  /** Node IDs to execute in parallel */
  branches: z.array(z.string()).min(1, 'At least one branch is required'),
  /** Strategy for joining parallel results */
  joinStrategy: z.enum(['all', 'any', 'race'], {
    message: 'Join strategy must be "all", "any", or "race"',
  }),
});

export type ParallelNodeConfig = z.infer<typeof parallelNodeConfigSchema>;

/**
 * Loop Node Configuration
 * Repeats execution while condition is true
 */
export const loopNodeConfigSchema = baseNodeConfigSchema.extend({
  /** Condition expression to evaluate each iteration */
  condition: z.string().min(1, 'Condition is required'),
  /** Maximum iterations to prevent infinite loops */
  maxIterations: z
    .number()
    .int()
    .positive('Max iterations must be positive')
    .max(1000, 'Max iterations cannot exceed 1000'),
  /** Node ID of the loop body */
  body: z.string().min(1, 'Loop body is required'),
});

export type LoopNodeConfig = z.infer<typeof loopNodeConfigSchema>;

/**
 * Human Review Node Configuration
 * Pauses workflow for human approval
 */
export const humanReviewNodeConfigSchema = baseNodeConfigSchema.extend({
  /** Prompt message for the reviewer */
  prompt: z.string().min(1, 'Prompt is required'),
  /** Timeout in seconds for waiting on review */
  timeout: z.number().int().positive('Timeout must be positive').optional(),
  /** Available response options */
  options: z.array(z.string()).optional(),
});

export type HumanReviewNodeConfig = z.infer<typeof humanReviewNodeConfigSchema>;

// ============================================================================
// Node Type Union
// ============================================================================

export type WorkflowNodeType = 'agent' | 'condition' | 'parallel' | 'loop' | 'human-review';

export type NodeConfig =
  | AgentNodeConfig
  | ConditionNodeConfig
  | ParallelNodeConfig
  | LoopNodeConfig
  | HumanReviewNodeConfig;

// ============================================================================
// Validation Helper
// ============================================================================

interface ValidationSuccess<T> {
  success: true;
  data: T;
}

interface ValidationError {
  success: false;
  error: string;
  errors: Array<{
    path: string[];
    message: string;
  }>;
}

type ValidationResult<T> = ValidationSuccess<T> | ValidationError;

/**
 * Validates node configuration based on node type
 * @param nodeType - The type of workflow node
 * @param config - The configuration object to validate
 * @returns Validation result with typed data or error details
 */
export function validateNodeConfig(
  nodeType: WorkflowNodeType,
  config: unknown,
): ValidationResult<NodeConfig> {
  const schemas: Record<WorkflowNodeType, z.ZodSchema> = {
    agent: agentNodeConfigSchema,
    condition: conditionNodeConfigSchema,
    parallel: parallelNodeConfigSchema,
    loop: loopNodeConfigSchema,
    'human-review': humanReviewNodeConfigSchema,
  };

  const schema = schemas[nodeType];
  if (!schema) {
    return {
      success: false,
      error: `Unknown node type: ${nodeType}`,
      errors: [{ path: ['type'], message: `Unknown node type: ${nodeType}` }],
    };
  }

  const result = schema.safeParse(config);

  if (result.success) {
    return {
      success: true,
      data: result.data as NodeConfig,
    };
  }

  return {
    success: false,
    error: 'Validation failed',
    errors: result.error.issues.map((e) => ({
      path: e.path.map(String),
      message: e.message,
    })),
  };
}
