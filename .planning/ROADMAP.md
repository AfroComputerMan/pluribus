# Roadmap: Pluribus

## Overview

Pluribus v1.0 transforms a single-chat prototype into a multi-agent orchestration desktop app. The roadmap follows a strict bottom-up dependency chain: first abstract the provider layer (replacing the Claude CLI adapter with Agent SDK and Codex providers), then build the central agent registry with lifecycle management and persistence, then add real-time streaming with user intervention controls, and finally deliver the multi-agent UI with split-pane views and notifications. Each phase delivers a complete, testable capability that the next phase builds on.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Provider Abstraction** - Unified agent provider interface with SDK and Codex implementations, process lifecycle management, and CLI adapter removal
- [ ] **Phase 2: Agent Registry and Lifecycle** - Central registry for spawning, tracking, and managing multiple agents with persistence and concurrency controls
- [ ] **Phase 3: Real-Time Streaming and Intervention** - Multiplexed output streaming from concurrent agents with tool approval, pause/resume, and backpressure
- [ ] **Phase 4: Multi-Agent UI** - Agent overview, drill-down views, split-pane layout, status indicators, and desktop notifications

## Phase Details

### Phase 1: Provider Abstraction
**Goal**: Users can start agents through a clean, unified provider interface that supports both Agent SDK and Codex backends, with robust process cleanup
**Depends on**: Nothing (first phase)
**Requirements**: PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06, PROV-07
**Success Criteria** (what must be TRUE):
  1. User can start an agent using the Agent SDK provider and receive streamed output
  2. User can start an agent using the Codex provider and receive streamed output
  3. All agent processes are cleaned up when the app exits or crashes (no orphaned processes remain)
  4. On app startup, orphaned processes from previous sessions are detected and terminated
  5. The old Claude CLI adapter and sh -c shell wrapper are fully removed from the codebase
**Plans**: 4 plans

Plans:
- [ ] 01-01-PLAN.md -- Foundation: types, provider registry, process manager, PID tracking migration
- [ ] 01-02-PLAN.md -- Agent SDK provider + sidecar shutdown/ping protocol
- [ ] 01-03-PLAN.md -- Codex provider + Rust PID exposure
- [ ] 01-04-PLAN.md -- Orchestrated adapter wiring, legacy removal, exit dialog

### Phase 2: Agent Registry and Lifecycle
**Goal**: Users can spawn multiple agents simultaneously, each with its own working directory and status, managed through a central registry with concurrency limits
**Depends on**: Phase 1
**Requirements**: ORCH-01, ORCH-02, ORCH-03, ORCH-08, PERS-01, PERS-02, PERS-03
**Success Criteria** (what must be TRUE):
  1. User can spawn multiple agents and each runs in its own specified working directory
  2. Agent status (running/idle/error/waiting-approval/completed) updates in real-time via push-based state
  3. Attempting to exceed the concurrent agent limit (default 5) queues or rejects the request with clear feedback
  4. Agent state (provider type, working directory, status) persists across app restarts
  5. Multiple agents writing to the database concurrently do not corrupt data (WAL mode + write serialization)
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: Real-Time Streaming and Intervention
**Goal**: Users can watch live output from multiple concurrent agents and intervene in real-time with tool approval and pause/resume controls
**Depends on**: Phase 2
**Requirements**: ORCH-04, ORCH-05, ORCH-06, ORCH-07
**Success Criteria** (what must be TRUE):
  1. User can view streaming output from multiple agents simultaneously without UI jank or dropped events
  2. When an agent requests tool approval, user sees a diff preview and can approve or reject the action
  3. User can pause a running agent and resume it later without losing context
  4. High-volume streaming from multiple agents is batched (50ms windows) to prevent IPC flooding
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: Multi-Agent UI
**Goal**: Users have a visual command center to see all agents at a glance, drill into individual threads, and get notified of important events
**Depends on**: Phase 3
**Requirements**: MAUI-01, MAUI-02, MAUI-03, MAUI-04, MAUI-05
**Success Criteria** (what must be TRUE):
  1. User sees an overview of all agents with real-time status indicators showing running/idle/error/waiting-approval/completed states
  2. User can click an agent in the overview to drill down into its full thread view with assistant-ui runtime
  3. User can view 2-4 agents simultaneously in a resizable split-pane layout
  4. User receives desktop notifications when an agent completes, errors, or needs approval
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Provider Abstraction | 2/4 | In Progress|  |
| 2. Agent Registry and Lifecycle | 0/0 | Not started | - |
| 3. Real-Time Streaming and Intervention | 0/0 | Not started | - |
| 4. Multi-Agent UI | 0/0 | Not started | - |
