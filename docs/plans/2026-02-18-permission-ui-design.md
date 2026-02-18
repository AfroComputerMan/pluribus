# Permission UI Design

## Summary

Add a tool permission approval system to Pluribus that intercepts Claude CLI tool_use events during streaming, presents an approval UI, and supports a global Shift+Tab toggle for auto-accept mode.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CLI mode | Keep `-p` + stream-json | Interactive mode requires TTY and doesn't support stream-json |
| Approval mechanism | UI-layer interception | Pause async generator on tool_use, await user response |
| Accept toggle | Global Shift+Tab | Toggles auto-accept mode for the session, with toast notification |
| Deny behavior | Kill process + resume session | Send no stdin; kill child, resume via `--resume` on next message |
| Persistence | Per-request only (v1) | No saved tool rules; can add persistent rules later |

## Architecture

### Stream Interception Flow

```
Stream tool_use event arrives
  ├─ Auto-accept ON? → continue streaming (no pause)
  └─ Auto-accept OFF?
       └─ Pause stream consumption (await promise)
       └─ Create ClaudePermissionRequest, emit to subscribers
       └─ Show PermissionApprovalBar in UI
            ├─ Approve → resolve promise, resume streaming
            └─ Deny → reject promise → kill child process
                      → resume session on next user message
```

### Key Trade-off

Claude CLI in `-p` mode executes tools immediately. "Deny" happens after the tool already ran. Denial means "stop this approach" — we kill the session and let Claude try again on resume. No undo of already-executed tools in v1.

## State Management

### Permission Mode (in claude-adapter.ts)

```typescript
let autoAcceptMode = false;  // toggled by Shift+Tab

// Pending permission requests
const pendingPermissions = new Map<string, {
  request: ClaudePermissionRequest;
  resolve: () => void;
  reject: (reason: Error) => void;
}>();

// Subscriber notification (useSyncExternalStore pattern, already wired up)
let permissionListeners = new Set<() => void>();
```

### Existing Scaffolding to Implement

These are already defined but stubbed out:
- `ClaudePermissionRequest` interface — add toolName, toolArgs fields
- `getClaudePermissionRequests()` — return pending requests from Map
- `subscribeClaudePermissionRequests()` — register/unregister listeners
- `respondToClaudePermissionRequest()` — resolve/reject the permission promise

## UI Components

### PermissionApprovalBar (enhance existing)

```
┌─────────────────────────────────────────────────────┐
│ 🔧 Claude wants to use: Bash                        │
│ Command: git status                                  │
│                                                      │
│              [Deny]  [Approve]  [Accept All ⇧⇥]     │
└─────────────────────────────────────────────────────┘
```

- Appears above composer when a permission request is pending
- Shows tool name + argument preview (bash command, file path, etc.)
- Keyboard: Enter = Approve, Escape = Deny
- "Accept All" button also toggles auto-accept mode ON

### Auto-Accept Mode Indicator

Persistent indicator when auto-accept is enabled:
- Toast on toggle: "Auto-accept enabled/disabled"
- Visual indicator in the UI (status area or persistent badge)

### Shift+Tab Global Handler

- Registered as a global keydown listener
- Toggles `autoAcceptMode` boolean
- Shows toast notification
- If toggling ON while a permission is pending → auto-approve the pending request

## Denial & Recovery

1. User clicks Deny → permission promise rejects
2. Stream loop catch handler calls `child.kill()`
3. Adapter marks the turn as interrupted
4. On next user message → adapter uses `--resume SESSION_ID` to continue
5. Claude sees prior context, can try a different approach

### Edge Cases

- **Multiple pending tools:** Denial kills the process; subsequent queued tools never execute (they're sequential in the stream)
- **Shift+Tab during pending:** Auto-approves the current request and enables auto-accept for the rest
- **Session resume after deny:** Uses existing retry strategy (resume → session-id → fresh)

## Files to Modify

1. **`src/lib/claude-adapter.ts`** — Core changes:
   - Implement permission request creation in `processStreamEvent()`
   - Implement the three permission functions (get/subscribe/respond)
   - Add `autoAcceptMode` state and toggle function
   - Add stream pause/resume logic via async promise in the generator loop

2. **`src/components/assistant-ui/thread.tsx`** — Enhance `PermissionApprovalBar`:
   - Show tool name and argument preview
   - Add "Accept All" button
   - Add Enter/Escape keyboard shortcuts

3. **New: `src/hooks/use-permission-mode.ts`** — Shift+Tab global handler:
   - Global keydown listener for Shift+Tab
   - Toggle function that calls into adapter
   - Toast notifications via shadcn toast

4. **`src/components/ThreadWorkspace.tsx`** or top-level — Mount the Shift+Tab hook

## Out of Scope (v1)

- Persistent tool rules (always allow/deny specific tools)
- Settings page for permission management
- Undo of already-executed tools on denial
- Per-tool-type approval rules
- ACP protocol integration
