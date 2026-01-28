# Plan: Agent Executor Wiring

**Date**: 2026-01-28
**Priority**: P0 - CRITICAL
**Estimated Time**: 2 hours

## Hypothesis

The agent executor is currently stubbed and returns placeholder results. By connecting it to the Claude Code adapter registry, we can enable real agent execution within workflows. This is the final critical piece needed for MVP.

## Goal

Wire the agent executor (`src/queue/workers/executors/agent.executor.ts`) to:
1. Fetch agent configuration from database
2. Connect to the Claude Code adapter
3. Execute tasks through the adapter
4. Stream output events
5. Track token usage and costs

## Expected Outcomes (Quantitative)

- **Functionality**: Agent nodes in workflows execute real Claude Code tasks
- **Output**: Node execution results stored in database
- **Observability**: Token usage and costs recorded in usageRecords table
- **Time**: Implementation completed in ~2 hours
- **Test Coverage**: Integration test for end-to-end workflow execution

## Implementation Approach

### 1. Import Dependencies
- Claude Code adapter from `@/integrations/adapters/claude-code`
- Database client and schema definitions
- Logger for observability
- Cost tracking utilities

### 2. Fetch Agent Configuration
- Query database for agent by ID
- Validate agent exists
- Extract model config and settings

### 3. Connect to Adapter
- Use environment variable for API key
- Establish connection to Claude Code
- Handle connection errors

### 4. Execute Task
- Build task object with prompt, context, tools
- Stream execution events
- Capture output chunks

### 5. Track Usage
- Accumulate token counts from events
- Record usage in database
- Calculate estimated costs

### 6. Error Handling
- Graceful adapter connection failures
- Task execution timeouts
- Database write errors

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| ANTHROPIC_API_KEY not configured | High | Check environment variable, provide clear error message |
| Adapter connection fails | High | Implement retry logic, log detailed error information |
| Database writes fail during execution | Medium | Use try-catch, don't fail execution for observability issues |
| Token usage tracking inaccurate | Low | Verify against adapter's estimateCost method |

## Acceptance Criteria

- ✅ Agent executor imports and uses Claude Code adapter
- ✅ Successfully fetches agent config from database
- ✅ Executes tasks and captures real output
- ✅ Streams events to logger
- ✅ Records token usage in usageRecords table
- ✅ Handles errors gracefully
- ✅ Integration test passes with real workflow execution

## Related Files

- `src/queue/workers/executors/agent.executor.ts` - Main implementation file
- `src/integrations/adapters/claude-code.ts` - Adapter to wire in
- `src/observability/cost-tracker.ts` - Usage recording
- `src/db/schema.ts` - Database schema
