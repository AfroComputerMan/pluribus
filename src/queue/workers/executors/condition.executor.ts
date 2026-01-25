import type { Job } from 'bullmq';

import type { ConditionNode } from '@/db/schema';
import { logger } from '@/observability/logger';
import type { NodeJobData } from '../../client';
import type { ExecutionContext, NodeExecutor, NodeProcessorResult } from '../types';

const log = logger.child('executor:condition');

/**
 * ConditionExecutor handles execution of condition (branching) nodes.
 * It evaluates an expression and returns which branch to take.
 */
export class ConditionExecutor implements NodeExecutor<ConditionNode> {
  readonly type = 'condition' as const;

  async execute(
    node: ConditionNode,
    context: ExecutionContext,
    _job: Job<NodeJobData>
  ): Promise<NodeProcessorResult> {
    const startedAt = new Date();

    log.info('Evaluating condition', {
      nodeId: node.id,
      expression: node.expression,
      runId: context.runId,
    });

    try {
      // Build evaluation context with workflow input and node results
      const evalContext = {
        input: context.input,
        results: Object.fromEntries(context.nodeResults),
      };

      // Evaluate the expression
      const result = this.evaluateExpression(node.expression, evalContext);

      const branch = result ? node.trueBranch : node.falseBranch;

      const completedAt = new Date();

      log.info('Condition evaluated', {
        nodeId: node.id,
        result,
        branch,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      });

      return {
        nodeId: node.id,
        status: 'completed',
        output: {
          result,
          branch,
          expression: node.expression,
        },
        startedAt,
        completedAt,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      log.error('Condition evaluation failed', {
        nodeId: node.id,
        expression: node.expression,
        error: errorMessage,
      });

      return {
        nodeId: node.id,
        status: 'failed',
        error: errorMessage,
        startedAt,
        completedAt: new Date(),
      };
    }
  }

  /**
   * Safely evaluate a condition expression.
   * Supports simple comparisons and logical operators.
   *
   * Supported syntax:
   * - input.field == "value"
   * - input.count > 10
   * - results.node1.success == true
   * - input.status == "approved" && input.amount > 100
   */
  private evaluateExpression(
    expression: string,
    context: { input: Record<string, unknown>; results: Record<string, unknown> }
  ): boolean {
    // Security: Use a safe expression evaluator instead of eval()
    // This is a simple implementation that handles common patterns

    try {
      // Replace context references with actual values
      let evaluable = expression;

      // Handle input.* references
      evaluable = evaluable.replace(/input\.(\w+)/g, (_, key) => {
        const value = context.input[key];
        return JSON.stringify(value);
      });

      // Handle results.nodeId.* references
      evaluable = evaluable.replace(/results\.(\w+)\.(\w+)/g, (_, nodeId, key) => {
        const nodeResult = context.results[nodeId] as Record<string, unknown> | undefined;
        const value = nodeResult?.[key];
        return JSON.stringify(value);
      });

      // Simple expression parser for safe evaluation
      return this.safeEvaluate(evaluable);
    } catch (error) {
      log.warn('Expression evaluation fallback to false', { expression, error });
      return false;
    }
  }

  /**
   * Safe expression evaluator for simple boolean expressions.
   */
  private safeEvaluate(expression: string): boolean {
    // Handle && (AND)
    if (expression.includes('&&')) {
      const parts = expression.split('&&').map((p) => p.trim());
      return parts.every((part) => this.safeEvaluate(part));
    }

    // Handle || (OR)
    if (expression.includes('||')) {
      const parts = expression.split('||').map((p) => p.trim());
      return parts.some((part) => this.safeEvaluate(part));
    }

    // Handle comparison operators
    const comparisonMatch = expression.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);

    if (comparisonMatch?.[1] && comparisonMatch[2] && comparisonMatch[3]) {
      const leftStr = comparisonMatch[1];
      const operator = comparisonMatch[2];
      const rightStr = comparisonMatch[3];
      const left = this.parseValue(leftStr.trim());
      const right = this.parseValue(rightStr.trim());

      switch (operator) {
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '>':
          return Number(left) > Number(right);
        case '<':
          return Number(left) < Number(right);
        case '>=':
          return Number(left) >= Number(right);
        case '<=':
          return Number(left) <= Number(right);
        default:
          return false;
      }
    }

    // Handle boolean literals
    if (expression.trim() === 'true') return true;
    if (expression.trim() === 'false') return false;

    // Try to parse as JSON boolean
    try {
      return Boolean(JSON.parse(expression));
    } catch {
      return false;
    }
  }

  /**
   * Parse a value from string representation.
   */
  private parseValue(str: string): unknown {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }
}

// Default singleton instance
export const conditionExecutor = new ConditionExecutor();
