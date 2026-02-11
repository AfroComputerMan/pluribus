# Data Extraction from Claude CLI — Exact Logic

## Overview
When a user submits a prompt, Pluribus spawns Claude CLI with `--output-format stream-json --verbose --include-partial-messages`. The CLI emits newline-delimited JSON on stdout. The adapter parses these incrementally.

## Step-by-Step Flow

### Step 1: Extract User Prompt — extractUserPrompt() (line 595)
- Takes assistant-ui message array, finds LAST user message (reversed search)
- Filters for type:"text" parts, joins with newline
- Only last message sent; history managed by CLI via --resume

### Step 2: Choose Strategy — chooseSessionStrategy() (line 607)
- No sessionId → strategy: "none" (fresh)
- localCache="missing" or status="stale" → strategy: "session-id"
- Otherwise → strategy: "resume" (fastest)

### Step 3: Build CLI Args
`claude -p <prompt> --output-format stream-json --verbose --include-partial-messages [--resume|--session-id <id>]`

### Step 4: Spawn — spawnClaudeStreaming() (line 887)
- Command.create("claude", args, {cwd}) via @tauri-apps/plugin-shell
- Queue+resolver pattern bridging callbacks→async generator
- Yields: stdout | stderr | close | error items

### Step 5: Parse JSON Events
| Event Type | Contents |
|-----------|---------|
| system | session_id, init capabilities |
| content_block_start | index, type (text/thinking/tool_use), initial content |
| content_block_delta | text/thinking delta, partial_json (tool args) |
| content_block_stop | block complete signal |
| assistant | full message snapshot with tool_results |
| result | session_id, is_error, result text, usage metrics |

### Step 6: Process into Accumulators — processStreamEvent() (line 697)
ContentBlockAccumulator[]: indexed by block position
- content_block_start → new accumulator
- content_block_delta → append text/thinking/partial_json
- assistant → reconcile tool_results to matching tool_use accumulators
- result → extract session_id, error info, detect "No conversation found"

### Step 7: Convert to UI — buildContentFromAccumulators() (line 653)
- thinking → { type: "reasoning", text }
- text → { type: "text", text }
- tool_use → { type: "tool-call", toolCallId, toolName, args: JSON.parse(argsJson) }

### Step 8: Throttled Yield (~60fps / 16ms intervals)
- pendingYield flag ensures final content is flushed on stream end

### Step 9: Retry on Errors (up to 3 attempts)
- Stale session → clear, retry fresh
- Session in use → clear, retry fresh
- Non-zero exit → throw

### Step 10: Post-Stream
- Update session record in SQLite
- Insert usage snapshot (tokens, cost)
- Fallback: if no accumulators but result text exists, yield that
