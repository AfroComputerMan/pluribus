import Database from "@tauri-apps/plugin-sql";

// ---------------------------------------------------------------------------
// Connection singleton
// ---------------------------------------------------------------------------

const DB_URL = "sqlite:pluribus.db";

let dbInstance: Database | null = null;
let dbPromise: Promise<Database> | null = null;
let ensureMcpInvocationsTablePromise: Promise<void> | null = null;
let ensureWorkspaceUniquenessPromise: Promise<void> | null = null;

/** Get or initialize the database singleton. Thread-safe via promise dedup. */
export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL).then((d) => {
      dbInstance = d;
      return d;
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Row types — mirror the database schema
// ---------------------------------------------------------------------------

export interface ThreadRow {
  id: string;
  remote_id: string;
  title: string | null;
  status: "regular" | "archived";
  session_id: string | null;
  cwd: string | null;
  workspace_id: string | null;
  git_branch: string | null;
  model: string | null;
  effort: string | null;
  dev_panel_open: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  cwd: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  thread_id: string;
  parent_id: string | null;
  role: "system" | "user" | "assistant";
  content: string;
  status: string | null;
  metadata: string | null;
  run_config: string | null;
  created_at: string;
}

export interface SessionRow {
  thread_id: string;
  session_id: string;
  status: string;
  last_updated_at: string;
}

export interface DevEventRow {
  id: string;
  thread_id: string;
  seq: number;
  category: string;
  raw: string;
  created_at: string;
}

export interface McpSnapshotRow {
  id: string;
  thread_id: string;
  session_id: string | null;
  servers: string;
  tools: string;
  mcp_tools: string;
  builtin_tools: string;
  skills: string | null;
  slash_commands: string | null;
  captured_at: string;
}

export interface McpInvocationRow {
  id: string;
  thread_id: string;
  session_id: string | null;
  tool_name: string;
  server_name: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  success: number;
  error: string | null;
  created_at: string;
}

export interface UsageSnapshotRow {
  id: string;
  thread_id: string;
  session_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  total_cost_usd: number | null;
  model_id: string | null;
  context_window: number | null;
  captured_at: string;
}

export interface ConfigOverrideRow {
  id: number;
  scope_type: "workspace" | "thread";
  scope_id: string;
  item_type: "mcp_server" | "skill" | "permission" | "command";
  item_name: string;
  enabled: number; // 0 or 1
  created_at: string;
}

export class DuplicateWorkspaceCwdError extends Error {
  readonly existingWorkspaceId: string;
  readonly cwd: string;

  constructor(existingWorkspaceId: string, cwd: string) {
    super("A workspace for this directory already exists.");
    this.name = "DuplicateWorkspaceCwdError";
    this.existingWorkspaceId = existingWorkspaceId;
    this.cwd = cwd;
  }
}

// ---------------------------------------------------------------------------
// threads
// ---------------------------------------------------------------------------

function normalizeCwd(cwd: string | null | undefined): string | null {
  const trimmed = cwd?.trim();
  if (!trimmed) return null;
  if (/^[\\/]+$/.test(trimmed)) return "/";
  if (/^[a-zA-Z]:[\\/]?$/.test(trimmed)) return `${trimmed[0]}:${"\\"}`;

  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/g, "");
  return withoutTrailingSeparators || trimmed;
}

function cwdComparisonKey(cwd: string | null | undefined): string | null {
  const normalized = normalizeCwd(cwd);
  if (!normalized) return null;
  return normalized.replace(/\\/g, "/");
}

async function threadsList(): Promise<ThreadRow[]> {
  const conn = await getDb();
  return conn.select<ThreadRow[]>(
    "SELECT * FROM threads WHERE status = $1 ORDER BY updated_at DESC",
    ["regular"],
  );
}

async function threadsGet(id: string): Promise<ThreadRow | null> {
  const conn = await getDb();
  const rows = await conn.select<ThreadRow[]>(
    "SELECT * FROM threads WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

async function threadsCreate(
  id: string,
  opts?: {
    cwd?: string | null;
    workspaceId?: string | null;
    gitBranch?: string | null;
    model?: string | null;
    effort?: string | null;
  },
): Promise<ThreadRow> {
  const conn = await getDb();
  const now = new Date().toISOString();
  const cwd = normalizeCwd(opts?.cwd);
  const workspaceId = opts?.workspaceId?.trim() || null;
  const gitBranch = opts?.gitBranch?.trim() || null;
  const model = opts?.model?.trim() || null;
  const effort = opts?.effort?.trim() || null;
  await conn.execute(
    `INSERT INTO threads (id, remote_id, status, cwd, workspace_id, git_branch, model, effort, created_at, updated_at)
     VALUES ($1, $1, 'regular', $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (id) DO NOTHING`,
    [id, cwd, workspaceId, gitBranch, model, effort, now],
  );
  const row = await threadsGet(id);
  if (!row) throw new Error(`Failed to create thread: ${id}`);
  return row;
}

/**
 * If `title` already exists among regular threads (excluding `excludeId`),
 * appends " (1)", " (2)", etc. until the title is unique.
 */
async function deduplicateTitle(
  title: string,
  excludeId?: string | null,
): Promise<string> {
  const conn = await getDb();
  const rows = await conn.select<{ title: string }[]>(
    `SELECT title FROM threads
     WHERE status = 'regular' AND title IS NOT NULL AND ($1 IS NULL OR id <> $1)`,
    [excludeId ?? null],
  );
  const existingTitles = new Set(rows.map((r) => r.title));
  if (!existingTitles.has(title)) return title;

  let n = 1;
  while (existingTitles.has(`${title} (${n})`)) n++;
  return `${title} (${n})`;
}

async function threadsRename(id: string, title: string): Promise<void> {
  const conn = await getDb();
  const uniqueTitle = await deduplicateTitle(title, id);
  await conn.execute(
    "UPDATE threads SET title = $1, updated_at = $2 WHERE id = $3",
    [uniqueTitle, new Date().toISOString(), id],
  );
}

async function threadsArchive(id: string): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    "UPDATE threads SET status = 'archived', updated_at = $1 WHERE id = $2",
    [new Date().toISOString(), id],
  );
}

async function threadsUnarchive(id: string): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    "UPDATE threads SET status = 'regular', updated_at = $1 WHERE id = $2",
    [new Date().toISOString(), id],
  );
}

async function threadsDelete(id: string): Promise<void> {
  const conn = await getDb();
  await conn.execute("DELETE FROM threads WHERE id = $1", [id]);
}

async function threadsUpdateSessionId(
  id: string,
  sessionId: string,
): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    "UPDATE threads SET session_id = $1, updated_at = $2 WHERE id = $3",
    [sessionId, new Date().toISOString(), id],
  );
}

async function threadsUpdateCwd(id: string, cwd: string): Promise<void> {
  const normalizedCwd = normalizeCwd(cwd);
  const conn = await getDb();
  await conn.execute(
    "UPDATE threads SET cwd = $1, updated_at = $2 WHERE id = $3",
    [normalizedCwd, new Date().toISOString(), id],
  );
}

async function threadsUpdateWorkspace(
  id: string,
  workspaceId: string | null,
  cwd: string | null,
): Promise<void> {
  const normalizedCwd = normalizeCwd(cwd);
  const conn = await getDb();
  await conn.execute(
    "UPDATE threads SET workspace_id = $1, cwd = $2, updated_at = $3 WHERE id = $4",
    [workspaceId, normalizedCwd, new Date().toISOString(), id],
  );
}

async function threadsUpdateGitBranch(
  id: string,
  gitBranch: string | null,
): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    "UPDATE threads SET git_branch = $1, updated_at = $2 WHERE id = $3",
    [gitBranch, new Date().toISOString(), id],
  );
}

async function threadsUpdateModel(
  id: string,
  model: string | null,
): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    "UPDATE threads SET model = $1, updated_at = $2 WHERE id = $3",
    [model, new Date().toISOString(), id],
  );
}

async function threadsUpdateEffort(
  id: string,
  effort: string | null,
): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    "UPDATE threads SET effort = $1, updated_at = $2 WHERE id = $3",
    [effort, new Date().toISOString(), id],
  );
}

async function threadsGetDevPanelOpen(id: string): Promise<boolean> {
  const row = await threadsGet(id);
  return row?.dev_panel_open === 1;
}

async function threadsSetDevPanelOpen(id: string, open: boolean): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    "UPDATE threads SET dev_panel_open = $1, updated_at = $2 WHERE id = $3",
    [open ? 1 : 0, new Date().toISOString(), id],
  );
}

// ---------------------------------------------------------------------------
// workspaces
// ---------------------------------------------------------------------------

async function ensureWorkspaceCwdUniqueness(): Promise<void> {
  if (ensureWorkspaceUniquenessPromise) return ensureWorkspaceUniquenessPromise;

  ensureWorkspaceUniquenessPromise = (async () => {
    const conn = await getDb();
    const rows = await conn.select<WorkspaceRow[]>(
      "SELECT * FROM workspaces ORDER BY created_at ASC",
      [],
    );

    const canonicalByKey = new Map<string, WorkspaceRow>();
    for (const row of rows) {
      const key = cwdComparisonKey(row.cwd);
      if (!key) continue;

      const existing = canonicalByKey.get(key);
      if (!existing) {
        canonicalByKey.set(key, row);
        continue;
      }

      const now = new Date().toISOString();
      await conn.execute(
        "UPDATE threads SET workspace_id = $1, updated_at = $2 WHERE workspace_id = $3",
        [existing.id, now, row.id],
      );
      await conn.execute("DELETE FROM workspaces WHERE id = $1", [row.id]);
    }
  })().finally(() => {
    ensureWorkspaceUniquenessPromise = null;
  });

  return ensureWorkspaceUniquenessPromise;
}

async function workspacesList(): Promise<WorkspaceRow[]> {
  await ensureWorkspaceCwdUniqueness();
  const conn = await getDb();
  return conn.select<WorkspaceRow[]>(
    "SELECT * FROM workspaces ORDER BY name COLLATE NOCASE ASC, created_at ASC",
    [],
  );
}

async function workspacesGet(id: string): Promise<WorkspaceRow | null> {
  await ensureWorkspaceCwdUniqueness();
  const conn = await getDb();
  const rows = await conn.select<WorkspaceRow[]>(
    "SELECT * FROM workspaces WHERE id = $1 LIMIT 1",
    [id],
  );
  return rows[0] ?? null;
}

async function workspacesGetByCwd(cwd: string): Promise<WorkspaceRow | null> {
  await ensureWorkspaceCwdUniqueness();
  const targetKey = cwdComparisonKey(cwd);
  if (!targetKey) return null;
  const conn = await getDb();
  const rows = await conn.select<WorkspaceRow[]>(
    "SELECT * FROM workspaces ORDER BY created_at ASC",
    [],
  );
  for (const row of rows) {
    if (cwdComparisonKey(row.cwd) === targetKey) {
      return row;
    }
  }
  return null;
}

async function workspacesCreate(name: string, cwd: string): Promise<WorkspaceRow> {
  const conn = await getDb();
  const now = new Date().toISOString();
  const normalizedName = name.trim();
  const normalizedCwd = normalizeCwd(cwd);
  if (!normalizedCwd) throw new Error("Workspace directory is required.");
  const existing = await workspacesGetByCwd(normalizedCwd);
  // TODO(noahr): Duplicate workspace detection is still not fully reliable in the app flow.
  if (existing) {
    throw new DuplicateWorkspaceCwdError(existing.id, normalizedCwd);
  }

  const id = crypto.randomUUID();
  await conn.execute(
    `INSERT INTO workspaces (id, name, cwd, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)`,
    [id, normalizedName, normalizedCwd, now],
  );
  const row = await workspacesGet(id);
  if (!row) throw new Error(`Failed to create workspace: ${normalizedName}`);
  return row;
}

async function workspacesRename(id: string, name: string): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    "UPDATE workspaces SET name = $1, updated_at = $2 WHERE id = $3",
    [name.trim(), new Date().toISOString(), id],
  );
}

async function workspacesDelete(id: string, cascade: boolean): Promise<void> {
  const conn = await getDb();
  if (cascade) {
    // Delete all threads in this workspace (ON DELETE CASCADE handles messages/sessions/etc.)
    await conn.execute("DELETE FROM threads WHERE workspace_id = $1", [id]);
  } else {
    // Orphan threads — move them to "Unassigned"
    await conn.execute(
      "UPDATE threads SET workspace_id = NULL, updated_at = $1 WHERE workspace_id = $2",
      [new Date().toISOString(), id],
    );
  }
  await conn.execute("DELETE FROM workspaces WHERE id = $1", [id]);
}

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

async function messagesLoadByThread(threadId: string): Promise<MessageRow[]> {
  const conn = await getDb();
  return conn.select<MessageRow[]>(
    "SELECT * FROM messages WHERE thread_id = $1 ORDER BY created_at",
    [threadId],
  );
}

async function messagesAppend(row: MessageRow): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    `INSERT INTO messages (id, thread_id, parent_id, role, content, status, metadata, run_config, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO NOTHING`,
    [
      row.id,
      row.thread_id,
      row.parent_id,
      row.role,
      row.content,
      row.status,
      row.metadata,
      row.run_config,
      row.created_at,
    ],
  );
}

async function messagesDeleteByThread(threadId: string): Promise<void> {
  const conn = await getDb();
  await conn.execute("DELETE FROM messages WHERE thread_id = $1", [threadId]);
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

async function sessionsGet(threadId: string): Promise<SessionRow | null> {
  const conn = await getDb();
  const rows = await conn.select<SessionRow[]>(
    "SELECT thread_id, session_id, status, last_updated_at FROM sessions WHERE thread_id = $1",
    [threadId],
  );
  return rows[0] ?? null;
}

async function sessionsUpsert(row: SessionRow): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    `INSERT INTO sessions (thread_id, session_id, status, last_updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (thread_id) DO UPDATE SET
       session_id = $2,
       status = $3,
       last_updated_at = $4`,
    [
      row.thread_id,
      row.session_id,
      row.status,
      row.last_updated_at,
    ],
  );
}

async function sessionsDelete(threadId: string): Promise<void> {
  const conn = await getDb();
  await conn.execute("DELETE FROM sessions WHERE thread_id = $1", [threadId]);
}

// ---------------------------------------------------------------------------
// dev_events
// ---------------------------------------------------------------------------

async function devEventsInsertBatch(events: DevEventRow[]): Promise<void> {
  if (events.length === 0) return;
  const conn = await getDb();

  const placeholders = events
    .map((_, i) => {
      const b = i * 6;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
    })
    .join(", ");

  const values = events.flatMap((e) => [
    e.id,
    e.thread_id,
    e.seq,
    e.category,
    e.raw,
    e.created_at,
  ]);

  await conn.execute(
    `INSERT OR IGNORE INTO dev_events (id, thread_id, seq, category, raw, created_at) VALUES ${placeholders}`,
    values,
  );
}

async function devEventsQueryByThread(
  threadId: string,
  opts?: { limit?: number; offset?: number },
): Promise<DevEventRow[]> {
  const conn = await getDb();
  const limit = opts?.limit ?? 1000;
  const offset = opts?.offset ?? 0;
  return conn.select<DevEventRow[]>(
    "SELECT * FROM dev_events WHERE thread_id = $1 ORDER BY seq DESC LIMIT $2 OFFSET $3",
    [threadId, limit, offset],
  );
}

async function devEventsQueryByCategory(
  category: string,
  opts?: { limit?: number; offset?: number },
): Promise<DevEventRow[]> {
  const conn = await getDb();
  const limit = opts?.limit ?? 1000;
  const offset = opts?.offset ?? 0;
  return conn.select<DevEventRow[]>(
    "SELECT * FROM dev_events WHERE category = $1 ORDER BY seq DESC LIMIT $2 OFFSET $3",
    [category, limit, offset],
  );
}

async function devEventsCount(): Promise<number> {
  const conn = await getDb();
  const rows = await conn.select<Array<{ count: number }>>(
    "SELECT COUNT(*) as count FROM dev_events",
    [],
  );
  return rows[0]?.count ?? 0;
}

async function devEventsPrune(keepCount: number): Promise<number> {
  const conn = await getDb();
  const result = await conn.execute(
    `DELETE FROM dev_events WHERE id NOT IN (
       SELECT id FROM dev_events ORDER BY seq DESC LIMIT $1
     )`,
    [keepCount],
  );
  return result.rowsAffected;
}

// ---------------------------------------------------------------------------
// mcp_snapshots
// ---------------------------------------------------------------------------

async function mcpSnapshotsInsert(row: McpSnapshotRow): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    `INSERT INTO mcp_snapshots (id, thread_id, session_id, servers, tools, mcp_tools, builtin_tools, skills, slash_commands, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      row.id,
      row.thread_id,
      row.session_id,
      row.servers,
      row.tools,
      row.mcp_tools,
      row.builtin_tools,
      row.skills,
      row.slash_commands,
      row.captured_at,
    ],
  );
}

async function mcpSnapshotsGetByThread(
  threadId: string,
): Promise<McpSnapshotRow[]> {
  const conn = await getDb();
  return conn.select<McpSnapshotRow[]>(
    "SELECT * FROM mcp_snapshots WHERE thread_id = $1 ORDER BY captured_at DESC",
    [threadId],
  );
}

async function mcpSnapshotsGetLatest(
  threadId: string,
): Promise<McpSnapshotRow | null> {
  const conn = await getDb();
  const rows = await conn.select<McpSnapshotRow[]>(
    "SELECT * FROM mcp_snapshots WHERE thread_id = $1 ORDER BY captured_at DESC LIMIT 1",
    [threadId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// mcp_invocations
// ---------------------------------------------------------------------------

async function mcpInvocationsInsert(row: McpInvocationRow): Promise<void> {
  const conn = await getDb();
  const values = [
    row.id,
    row.thread_id,
    row.session_id,
    row.tool_name,
    row.server_name,
    row.input_tokens,
    row.output_tokens,
    row.cost_usd,
    row.duration_ms,
    row.success,
    row.error,
    row.created_at,
  ];

  try {
    await conn.execute(
      `INSERT INTO mcp_invocations (id, thread_id, session_id, tool_name, server_name, input_tokens, output_tokens, cost_usd, duration_ms, success, error, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      values,
    );
  } catch (error) {
    if (!isMissingTableError(error, "mcp_invocations")) throw error;
    await ensureMcpInvocationsTable();
    await conn.execute(
      `INSERT INTO mcp_invocations (id, thread_id, session_id, tool_name, server_name, input_tokens, output_tokens, cost_usd, duration_ms, success, error, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      values,
    );
  }
}

function isMissingTableError(error: unknown, table: string): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes(`no such table: ${table}`);
}

async function ensureMcpInvocationsTable(): Promise<void> {
  if (!ensureMcpInvocationsTablePromise) {
    ensureMcpInvocationsTablePromise = (async () => {
      const conn = await getDb();
      await conn.execute(
        `CREATE TABLE IF NOT EXISTS mcp_invocations (
           id              TEXT PRIMARY KEY,
           thread_id       TEXT NOT NULL,
           session_id      TEXT,
           tool_name       TEXT NOT NULL,
           server_name     TEXT,
           input_tokens    INTEGER,
           output_tokens   INTEGER,
           cost_usd        REAL,
           duration_ms     INTEGER,
           success         INTEGER NOT NULL DEFAULT 1,
           error           TEXT,
           created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
           FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
         )`,
        [],
      );
      await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_mcp_invocations_thread ON mcp_invocations(thread_id)",
        [],
      );
      await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_mcp_invocations_tool ON mcp_invocations(tool_name)",
        [],
      );
    })().catch((error) => {
      ensureMcpInvocationsTablePromise = null;
      throw error;
    });
  }

  await ensureMcpInvocationsTablePromise;
}

async function mcpInvocationsGetByThread(
  threadId: string,
): Promise<McpInvocationRow[]> {
  const conn = await getDb();
  return conn.select<McpInvocationRow[]>(
    "SELECT * FROM mcp_invocations WHERE thread_id = $1 ORDER BY created_at DESC",
    [threadId],
  );
}

async function mcpInvocationsGetByTool(
  toolName: string,
  opts?: { limit?: number; offset?: number },
): Promise<McpInvocationRow[]> {
  const conn = await getDb();
  const limit = opts?.limit ?? 1000;
  const offset = opts?.offset ?? 0;
  return conn.select<McpInvocationRow[]>(
    "SELECT * FROM mcp_invocations WHERE tool_name = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    [toolName, limit, offset],
  );
}

// ---------------------------------------------------------------------------
// usage_snapshots
// ---------------------------------------------------------------------------

async function usageSnapshotsInsert(row: UsageSnapshotRow): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    `INSERT INTO usage_snapshots (id, thread_id, session_id, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, total_cost_usd, model_id, context_window, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      row.id,
      row.thread_id,
      row.session_id,
      row.input_tokens,
      row.output_tokens,
      row.cache_creation_input_tokens,
      row.cache_read_input_tokens,
      row.total_cost_usd,
      row.model_id,
      row.context_window,
      row.captured_at,
    ],
  );
}

async function usageSnapshotsGetByThread(
  threadId: string,
): Promise<UsageSnapshotRow[]> {
  const conn = await getDb();
  return conn.select<UsageSnapshotRow[]>(
    "SELECT * FROM usage_snapshots WHERE thread_id = $1 ORDER BY captured_at DESC",
    [threadId],
  );
}

async function usageSnapshotsGetLatest(
  threadId: string,
): Promise<UsageSnapshotRow | null> {
  const conn = await getDb();
  const rows = await conn.select<UsageSnapshotRow[]>(
    "SELECT * FROM usage_snapshots WHERE thread_id = $1 ORDER BY captured_at DESC LIMIT 1",
    [threadId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Config overrides
// ---------------------------------------------------------------------------

async function configOverridesList(
  scopeType: ConfigOverrideRow["scope_type"],
  scopeId: string,
): Promise<ConfigOverrideRow[]> {
  const d = await getDb();
  return d.select<ConfigOverrideRow[]>(
    "SELECT * FROM config_overrides WHERE scope_type = $1 AND scope_id = $2",
    [scopeType, scopeId],
  );
}

async function configOverridesUpsert(
  scopeType: ConfigOverrideRow["scope_type"],
  scopeId: string,
  itemType: ConfigOverrideRow["item_type"],
  itemName: string,
  enabled: boolean,
): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT INTO config_overrides (scope_type, scope_id, item_type, item_name, enabled)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (scope_type, scope_id, item_type, item_name)
     DO UPDATE SET enabled = $5`,
    [scopeType, scopeId, itemType, itemName, enabled ? 1 : 0],
  );
}

async function configOverridesDelete(
  scopeType: ConfigOverrideRow["scope_type"],
  scopeId: string,
  itemType: ConfigOverrideRow["item_type"],
  itemName: string,
): Promise<void> {
  const d = await getDb();
  await d.execute(
    "DELETE FROM config_overrides WHERE scope_type = $1 AND scope_id = $2 AND item_type = $3 AND item_name = $4",
    [scopeType, scopeId, itemType, itemName],
  );
}

async function configOverridesDeleteByScope(
  scopeType: ConfigOverrideRow["scope_type"],
  scopeId: string,
): Promise<void> {
  const d = await getDb();
  await d.execute(
    "DELETE FROM config_overrides WHERE scope_type = $1 AND scope_id = $2",
    [scopeType, scopeId],
  );
}

// ---------------------------------------------------------------------------
// Public API — namespaced for clean imports
// ---------------------------------------------------------------------------

export const db = {
  threads: {
    list: threadsList,
    get: threadsGet,
    create: threadsCreate,
    rename: threadsRename,
    archive: threadsArchive,
    unarchive: threadsUnarchive,
    delete: threadsDelete,
    updateSessionId: threadsUpdateSessionId,
    updateCwd: threadsUpdateCwd,
    updateWorkspace: threadsUpdateWorkspace,
    updateGitBranch: threadsUpdateGitBranch,
    updateModel: threadsUpdateModel,
    updateEffort: threadsUpdateEffort,
    getDevPanelOpen: threadsGetDevPanelOpen,
    setDevPanelOpen: threadsSetDevPanelOpen,
  },
  workspaces: {
    list: workspacesList,
    get: workspacesGet,
    getByCwd: workspacesGetByCwd,
    create: workspacesCreate,
    rename: workspacesRename,
    delete: workspacesDelete,
  },
  messages: {
    loadByThread: messagesLoadByThread,
    append: messagesAppend,
    deleteByThread: messagesDeleteByThread,
  },
  sessions: {
    get: sessionsGet,
    upsert: sessionsUpsert,
    delete: sessionsDelete,
  },
  devEvents: {
    insertBatch: devEventsInsertBatch,
    queryByThread: devEventsQueryByThread,
    queryByCategory: devEventsQueryByCategory,
    count: devEventsCount,
    prune: devEventsPrune,
  },
  mcpSnapshots: {
    insert: mcpSnapshotsInsert,
    getByThread: mcpSnapshotsGetByThread,
    getLatest: mcpSnapshotsGetLatest,
  },
  mcpInvocations: {
    insert: mcpInvocationsInsert,
    getByThread: mcpInvocationsGetByThread,
    getByTool: mcpInvocationsGetByTool,
  },
  usageSnapshots: {
    insert: usageSnapshotsInsert,
    getByThread: usageSnapshotsGetByThread,
    getLatest: usageSnapshotsGetLatest,
  },
  configOverrides: {
    list: configOverridesList,
    upsert: configOverridesUpsert,
    delete: configOverridesDelete,
    deleteByScope: configOverridesDeleteByScope,
  },
} as const;
