# Act: Pluribus Desktop Pivot

**Feature**: Native desktop application learnings and improvements
**Completed**: TBD
**Status**: Not Started (Will be created after evaluation)

---

## Success Pattern → Formalization

### Patterns to Document

*Will be identified during implementation and evaluation*

#### Pattern 1: CLI Wrapper Architecture
- **Context**: Building GUI applications on top of CLI tools
- **Solution**: Spawn CLI with structured output format, stream via IPC, parse in frontend
- **Benefits**: Piggyback on existing subscription/auth, decouple UI from CLI internals
- **Expected Location**: `docs/patterns/cli-wrapper-architecture.md`

#### Pattern 2: Tauri IPC for Streaming
- **Context**: Real-time data from Rust to React
- **Solution**: Tauri Channels with per-session scoping
- **Benefits**: No global event fan-out, type-safe, high throughput
- **Expected Location**: `docs/patterns/tauri-ipc-streaming.md`

#### Pattern 3: Drizzle sqlite-proxy
- **Context**: Type-safe database queries in a WebView app
- **Solution**: Drizzle ORM in TypeScript, SQL execution delegated to Rust via invoke()
- **Benefits**: Full Drizzle query builder, schema migration, type safety
- **Expected Location**: `docs/patterns/drizzle-sqlite-proxy.md`

---

## Learnings → Global Rules

### CLAUDE.md Updates

#### Update 1: Desktop App Architecture
**Rationale**: Future contributors need to understand the Tauri + React architecture
**Content to Add**:
```markdown
## Desktop App Architecture (Tauri 2.0)
- Rust core: process management, SQLite, git worktrees (~500-1000 LOC)
- React frontend: all app logic, Zustand stores, Drizzle ORM
- IPC: invoke() for commands, Channel<T> for streaming, listen() for events
- Database: SQLite via Drizzle sqlite-proxy pattern
```

#### Update 2: NDJSON Parser Testing
**Rationale**: The parser is the most critical code path — must maintain high coverage
**Content to Add**:
```markdown
## NDJSON Parser
- Coverage target: 90%+
- Test with real CLI output captures
- Handle unknown message types gracefully (log + skip)
- Pin Claude CLI version in test fixtures
```

---

## Technical Debt

### Anticipated Debt Items

#### Debt Item 1: Agent Teams Experimental API
- **Impact**: Medium — API could change, breaking team monitoring
- **Effort to Fix**: 1-2 days per breaking change
- **Priority**: P2 (accepted risk)
- **Mitigation**: Isolate behind useTeamWatcher interface
- **Future Plan**: Migrate to stable API when available

#### Debt Item 2: Permission MCP Server Complexity
- **Impact**: Medium — Rust MCP server is additional complexity
- **Effort to Fix**: N/A (architectural choice)
- **Priority**: P3
- **Mitigation**: Start with autonomous-only mode, add permission server in Phase 5
- **Future Plan**: Consider extracting to standalone crate if reusable

#### Debt Item 3: CLI Output Format Coupling
- **Impact**: High — Claude CLI format changes break everything
- **Effort to Fix**: 1-3 days per breaking change
- **Priority**: P1 (critical dependency)
- **Mitigation**: Comprehensive test suite, graceful unknown-type handling
- **Future Plan**: Consider SDK migration when subscription-based SDK becomes available

### Discovered During Implementation

*Will be documented as discovered*

---

## Improvements for Next Implementation

### Process Improvements

*Will be documented after project completion*

### Technical Improvements

*Will be documented after project completion*

---

## Migration Checklist

### What to Carry Over from Old Pluribus

**Frontend Components (Copy):**
- [ ] Button.tsx → src/components/common/Button.tsx
- [ ] StatusBadge.tsx → src/components/common/StatusBadge.tsx
- [ ] DataTable.tsx → src/components/common/DataTable.tsx
- [ ] JsonViewer.tsx → src/components/common/JsonViewer.tsx

**Frontend Components (Adapt):**
- [ ] CostTrackingPanel.tsx → adapt for session-based cost tracking
- [ ] useKeyboardShortcuts.ts → adapt shortcut set for desktop app

**Frontend Patterns (Reference):**
- [ ] workflowBuilderStore.ts → pattern for chatStore/sessionStore
- [ ] api/client.ts → pattern for ipc/commands.ts
- [ ] useSSE.ts → pattern for ipc/channels.ts

**Backend Logic (Port to Rust):**
- [ ] integrations/adapters/claude-code.ts → src-tauri/src/process/manager.rs
- [ ] NDJSON parsing logic → src/lib/ndjson-parser.ts (stays in TS)

**Backend Logic (Port to TypeScript):**
- [ ] lib/errors.ts → src/lib/errors.ts (simplify)
- [ ] Cost calculation → src/lib/cost.ts

### What to Leave Behind

- Hono API server + routes + middleware
- PostgreSQL schema + Drizzle postgres client
- Redis + BullMQ queues + workers
- DAG workflow engine + WorkflowCanvas + NodePalette
- Docker runtime isolation
- Trigger/scheduler system
- All workflow-related frontend (WorkflowBuilderPage, ExecutionOverlay, etc.)

---

## Future Features (Out of Scope for MVP)

### High Priority (v1.1 — Next Month)

1. **Session Snapshots / Checkpoints**
   - **Why**: Claudia has this, users want to branch conversations
   - **Effort**: 5 days
   - **Value**: High — enables experimentation without losing progress

2. **Session Search**
   - **Why**: Finding conversations across sessions
   - **Effort**: 2 days (SQLite full-text search)
   - **Value**: Medium — important as session count grows

3. **Agent Template Library**
   - **Why**: Pre-configured agents for common tasks
   - **Effort**: 3 days
   - **Value**: Medium — reduces setup time

### Medium Priority (v1.2 — Next Quarter)

4. **Conversation Export**
   - **Why**: Share conversations, create documentation
   - **Effort**: 2 days
   - **Value**: Medium

5. **Multi-Monitor Support**
   - **Why**: Detach sessions to separate windows
   - **Effort**: 3 days
   - **Value**: Medium — power user feature

6. **Session Analytics Dashboard**
   - **Why**: Understand usage patterns, costs over time
   - **Effort**: 5 days
   - **Value**: Medium

### Low Priority (Future)

7. **Cloud Sync (optional)**
8. **Voice Input**
9. **Plugin System**
10. **Custom MCP Server Builder UI**

---

## Mistakes → Prevention

*Will be documented as mistakes occur*

### Mistake Template
- **What Happened**: Description
- **Root Cause**: Why (with evidence)
- **Impact**: What broke, how long to fix
- **Prevention Checklist**:
  - [ ] Step 1
  - [ ] Step 2
- **Documentation**: `docs/mistakes/desktop-pivot-[topic]-YYYY-MM-DD.md`

---

## Knowledge Base Updates

### Documentation to Create

1. **User Guide**: `docs/user-guide/desktop-app.md`
   - Installation and first launch
   - Creating sessions
   - Using worktrees
   - Agent Teams
   - Diff review
   - Keyboard shortcuts

2. **Developer Guide**: `docs/developer-guide/desktop-architecture.md`
   - Tauri + React architecture
   - Rust process manager
   - NDJSON parser
   - IPC protocol
   - Adding new features

3. **Build Guide**: `docs/developer-guide/desktop-build.md`
   - Development setup (Rust + Bun)
   - `cargo tauri dev`
   - `cargo tauri build`
   - Cross-platform packaging
   - CI/CD pipeline

### Documentation to Update

1. **CLAUDE.md**: Add desktop app architecture section
2. **README.md**: Pivot project description from backend to desktop app
3. **ROADMAP.md**: Update with desktop app phases

---

## Action Items

### Immediate (Before Starting Phase 1)
- [ ] Get plan approval
- [ ] Set up Rust development environment
- [ ] Verify Claude CLI is installed and working
- [ ] Test `claude --output-format stream-json` manually

### After Phase 1
- [ ] Evaluate: is the CLI wrapper approach viable?
- [ ] Measure streaming latency
- [ ] Decide: continue to Phase 2 or pivot approach?

### After MVP (Phase 5)
- [ ] User testing with 3+ people
- [ ] Performance profiling (memory, CPU)
- [ ] Create distributable binary
- [ ] Write installation docs

---

## Notes

This document will be completed after:
1. Implementation is finished (`do.md` complete)
2. Evaluation is done (`check.md` complete)
3. Patterns and learnings are identified
4. User feedback is collected

The Act phase captures knowledge for continuous improvement.
