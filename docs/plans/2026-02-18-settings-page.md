# Settings Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a full-screen overlay settings page that reads Claude Code config files from disk and lets users toggle MCP servers, skills, and permissions on/off per-workspace and per-thread.

**Architecture:** A config reader module uses Tauri's shell plugin (`Command.create("claude-stream-sh", ...)`) to read JSON/YAML files from `~/.claude/` and project `.claude/` directories. A SQLite migration adds a `config_overrides` table for toggle state. A React component renders the layered config explorer as a full-screen overlay accessible from the sidebar footer.

**Tech Stack:** React 19, Tauri shell plugin (for file reads), tauri-plugin-sql (SQLite), shadcn/ui primitives, Lucide icons, Tailwind CSS v4, assistant-ui thread context.

**Design doc:** `docs/plans/2026-02-18-settings-page-design.md`

---

### Task 1: Add SQLite migration for config_overrides table

**Files:**
- Create: `src-tauri/migrations/006_config_overrides.sql`
- Modify: `src-tauri/src/lib.rs:10-41` (add migration 6 to vec)

**Step 1: Create the migration SQL file**

Create `src-tauri/migrations/006_config_overrides.sql`:

```sql
CREATE TABLE IF NOT EXISTS config_overrides (
  id        INTEGER PRIMARY KEY,
  scope_type TEXT    NOT NULL CHECK (scope_type IN ('workspace', 'thread')),
  scope_id   TEXT    NOT NULL,
  item_type  TEXT    NOT NULL CHECK (item_type IN ('mcp_server', 'skill', 'permission', 'command')),
  item_name  TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(scope_type, scope_id, item_type, item_name)
);

CREATE INDEX idx_config_overrides_scope
  ON config_overrides (scope_type, scope_id);
```

**Step 2: Register migration in Rust**

In `src-tauri/src/lib.rs`, add after the migration 5 entry (after line 40):

```rust
        Migration {
            version: 6,
            description: "config_overrides",
            sql: include_str!("../migrations/006_config_overrides.sql"),
            kind: MigrationKind::Up,
        },
```

**Step 3: Verify it compiles**

Run: `cd /home/user/projects/pluribus && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add src-tauri/migrations/006_config_overrides.sql src-tauri/src/lib.rs
git commit -m "feat: add config_overrides migration for settings page"
```

---

### Task 2: Add config_overrides DB operations to db.ts

**Files:**
- Modify: `src/lib/db.ts` (add row type, CRUD functions, namespace)

**Step 1: Add the row type**

In `src/lib/db.ts`, after the last row interface (around line 90), add:

```typescript
export interface ConfigOverrideRow {
  id: number;
  scope_type: "workspace" | "thread";
  scope_id: string;
  item_type: "mcp_server" | "skill" | "permission" | "command";
  item_name: string;
  enabled: number; // 0 or 1
  created_at: string;
}
```

**Step 2: Add CRUD functions**

Before the `export const db = {` line (around line 810), add:

```typescript
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
```

**Step 3: Add to the db namespace**

In the `export const db = { ... }` object, add a new namespace:

```typescript
  configOverrides: {
    list: configOverridesList,
    upsert: configOverridesUpsert,
    delete: configOverridesDelete,
    deleteByScope: configOverridesDeleteByScope,
  },
```

**Step 4: Verify types**

Run: `cd /home/user/projects/pluribus && bunx tsc --noEmit`
Expected: No type errors.

**Step 5: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add config_overrides CRUD operations to db layer"
```

---

### Task 3: Create the config reader module

This module reads Claude Code config files from disk using the existing shell command pattern.

**Files:**
- Create: `src/lib/claude-config-reader.ts`

**Step 1: Create the config reader**

Create `src/lib/claude-config-reader.ts`:

```typescript
import { Command } from "@tauri-apps/plugin-shell";
import { homeDir } from "@tauri-apps/api/path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpServerConfig {
  name: string;
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  source: "global" | "project";
  sourcePath: string;
}

export interface SkillConfig {
  name: string;
  description: string;
  source: "global" | "project";
  sourcePath: string;
}

export interface CommandConfig {
  name: string;
  fileName: string;
  source: "global" | "project";
}

export interface ConfigScope {
  mcpServers: McpServerConfig[];
  skills: SkillConfig[];
  permissions: string[];
  commands: CommandConfig[];
}

export interface ResolvedConfig {
  global: ConfigScope;
  projects: Map<string, ConfigScope>;
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

/** Read a file from disk via shell. Returns null if file doesn't exist. */
async function readFile(path: string): Promise<string | null> {
  try {
    const cmd = Command.create("claude-stream-sh", [
      "-c",
      `cat "${path}" 2>/dev/null`,
    ]);
    const result = await cmd.execute();
    if (result.code !== 0 || !result.stdout.trim()) return null;
    return result.stdout;
  } catch {
    return null;
  }
}

/** List files matching a glob pattern. Returns array of absolute paths. */
async function listFiles(pattern: string): Promise<string[]> {
  try {
    const cmd = Command.create("claude-stream-sh", [
      "-c",
      `ls -1 ${pattern} 2>/dev/null || true`,
    ]);
    const result = await cmd.execute();
    if (result.code !== 0 || !result.stdout.trim()) return [];
    return result.stdout
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/** List directories in a path. */
async function listDirs(path: string): Promise<string[]> {
  try {
    const cmd = Command.create("claude-stream-sh", [
      "-c",
      `find "${path}" -maxdepth 1 -mindepth 1 -type d -o -type l 2>/dev/null | sort`,
    ]);
    const result = await cmd.execute();
    if (result.code !== 0 || !result.stdout.trim()) return [];
    return result.stdout
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/** Recursively find .mcp.json files under a directory. */
async function findMcpJsonFiles(dir: string): Promise<string[]> {
  try {
    const cmd = Command.create("claude-stream-sh", [
      "-c",
      `find "${dir}" -name ".mcp.json" -type f 2>/dev/null`,
    ]);
    const result = await cmd.execute();
    if (result.code !== 0 || !result.stdout.trim()) return [];
    return result.stdout
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseJsonSafe(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Extract permissions from a settings.json or settings.local.json */
function extractPermissions(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];
  const settings = obj as Record<string, unknown>;
  const perms = settings.permissions as Record<string, unknown> | undefined;
  if (!perms) return [];
  const allow = perms.allow;
  if (!Array.isArray(allow)) return [];
  return allow.filter((p): p is string => typeof p === "string");
}

/** Parse MCP server entries from a .mcp.json file */
function parseMcpServers(
  raw: string,
  source: "global" | "project",
  sourcePath: string,
): McpServerConfig[] {
  const obj = parseJsonSafe(raw);
  if (!obj || typeof obj !== "object") return [];

  // .mcp.json may have { mcpServers: { ... } } or just { serverName: { ... } }
  const root = obj as Record<string, unknown>;
  const servers = (root.mcpServers ?? root) as Record<string, unknown>;

  const results: McpServerConfig[] = [];
  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg || typeof cfg !== "object") continue;
    const entry = cfg as Record<string, unknown>;
    results.push({
      name,
      type: (entry.type as "stdio" | "http") ?? "stdio",
      command: entry.command as string | undefined,
      args: entry.args as string[] | undefined,
      url: entry.url as string | undefined,
      headers: entry.headers as Record<string, string> | undefined,
      env: entry.env as Record<string, string> | undefined,
      source,
      sourcePath,
    });
  }
  return results;
}

/** Parse skill frontmatter from a SKILL.md file */
function parseSkillMd(
  raw: string,
  source: "global" | "project",
  sourcePath: string,
): SkillConfig | null {
  // Extract YAML frontmatter between --- markers
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    // No frontmatter — use filename-based name
    const nameMatch = sourcePath.match(/\/([^/]+)\/SKILL\.md$/i);
    return nameMatch
      ? { name: nameMatch[1], description: "", source, sourcePath }
      : null;
  }

  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  const name = nameMatch?.[1]?.trim() ?? sourcePath.split("/").at(-2) ?? "unknown";
  const description = descMatch?.[1]?.trim() ?? "";

  return { name, description, source, sourcePath };
}

// ---------------------------------------------------------------------------
// Main reader
// ---------------------------------------------------------------------------

let cachedHome: string | null = null;

async function getHome(): Promise<string> {
  if (cachedHome) return cachedHome;
  cachedHome = await homeDir();
  // homeDir() returns trailing slash on some platforms
  cachedHome = cachedHome.replace(/\/+$/, "");
  return cachedHome;
}

/** Read global Claude Code config from ~/.claude/ */
async function readGlobalConfig(): Promise<ConfigScope> {
  const home = await getHome();
  const claudeDir = `${home}/.claude`;

  // 1. Permissions from settings.json + settings.local.json
  const [settingsRaw, settingsLocalRaw] = await Promise.all([
    readFile(`${claudeDir}/settings.json`),
    readFile(`${claudeDir}/settings.local.json`),
  ]);
  const permissions = [
    ...extractPermissions(settingsRaw ? parseJsonSafe(settingsRaw) : null),
    ...extractPermissions(settingsLocalRaw ? parseJsonSafe(settingsLocalRaw) : null),
  ];

  // 2. MCP servers from plugin .mcp.json files
  const mcpFiles = await findMcpJsonFiles(`${claudeDir}/plugins`);
  const mcpRaws = await Promise.all(mcpFiles.map((f) => readFile(f)));
  const mcpServers: McpServerConfig[] = [];
  for (let i = 0; i < mcpFiles.length; i++) {
    const raw = mcpRaws[i];
    if (raw) mcpServers.push(...parseMcpServers(raw, "global", mcpFiles[i]));
  }

  // Also check for a top-level .mcp.json in ~/.claude/
  const topMcpRaw = await readFile(`${claudeDir}/.mcp.json`);
  if (topMcpRaw) {
    mcpServers.push(...parseMcpServers(topMcpRaw, "global", `${claudeDir}/.mcp.json`));
  }

  // 3. Skills from ~/.claude/skills/
  const skillDirs = await listDirs(`${claudeDir}/skills`);
  const skills: SkillConfig[] = [];
  const skillRaws = await Promise.all(
    skillDirs.map((d) => readFile(`${d}/SKILL.md`)),
  );
  for (let i = 0; i < skillDirs.length; i++) {
    const raw = skillRaws[i];
    if (!raw) continue;
    const skill = parseSkillMd(raw, "global", `${skillDirs[i]}/SKILL.md`);
    if (skill) skills.push(skill);
  }

  // 4. Commands from ~/.claude/commands/
  const commandFiles = await listFiles(`${claudeDir}/commands/**/*.md`);
  const commands: CommandConfig[] = commandFiles.map((f) => {
    const parts = f.split("/");
    const fileName = parts.at(-1) ?? "";
    const name = fileName.replace(/\.md$/, "");
    return { name, fileName, source: "global" as const };
  });

  return { mcpServers, skills, permissions, commands };
}

/** Read project-level Claude Code config from a workspace directory */
async function readProjectConfig(cwd: string): Promise<ConfigScope> {
  // 1. Permissions from .claude/settings.local.json
  const settingsLocalRaw = await readFile(`${cwd}/.claude/settings.local.json`);
  const permissions = extractPermissions(
    settingsLocalRaw ? parseJsonSafe(settingsLocalRaw) : null,
  );

  // 2. MCP servers from project .mcp.json
  const mcpRaw = await readFile(`${cwd}/.mcp.json`);
  const mcpServers = mcpRaw ? parseMcpServers(mcpRaw, "project", `${cwd}/.mcp.json`) : [];

  // Also check .claude/.mcp.json
  const dotClaudeMcpRaw = await readFile(`${cwd}/.claude/.mcp.json`);
  if (dotClaudeMcpRaw) {
    mcpServers.push(...parseMcpServers(dotClaudeMcpRaw, "project", `${cwd}/.claude/.mcp.json`));
  }

  // 3. Skills from .claude/skills/
  const skillDirs = await listDirs(`${cwd}/.claude/skills`);
  const skills: SkillConfig[] = [];
  const skillRaws = await Promise.all(
    skillDirs.map((d) => readFile(`${d}/SKILL.md`)),
  );
  for (let i = 0; i < skillDirs.length; i++) {
    const raw = skillRaws[i];
    if (!raw) continue;
    const skill = parseSkillMd(raw, "project", `${skillDirs[i]}/SKILL.md`);
    if (skill) skills.push(skill);
  }

  // 4. Commands from .claude/commands/
  const commandFiles = await listFiles(`${cwd}/.claude/commands/**/*.md`);
  const commands: CommandConfig[] = commandFiles.map((f) => {
    const parts = f.split("/");
    const fileName = parts.at(-1) ?? "";
    const name = fileName.replace(/\.md$/, "");
    return { name, fileName, source: "project" as const };
  });

  return { mcpServers, skills, permissions, commands };
}

/**
 * Read the full Claude Code config hierarchy.
 * @param workspaceCwds - Array of workspace directory paths to scan for project configs.
 */
export async function readClaudeConfig(
  workspaceCwds: string[],
): Promise<ResolvedConfig> {
  const global = await readGlobalConfig();

  const projects = new Map<string, ConfigScope>();
  const projectConfigs = await Promise.all(
    workspaceCwds.map((cwd) => readProjectConfig(cwd)),
  );
  for (let i = 0; i < workspaceCwds.length; i++) {
    projects.set(workspaceCwds[i], projectConfigs[i]);
  }

  return { global, projects };
}
```

**Step 2: Verify types**

Run: `cd /home/user/projects/pluribus && bunx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/lib/claude-config-reader.ts
git commit -m "feat: add Claude Code config reader module"
```

---

### Task 4: Create the SettingsOverlay component

This is the main settings UI — the full-screen overlay with scope nav and config panel.

**Files:**
- Create: `src/components/settings-overlay.tsx`

**Step 1: Create the component**

Create `src/components/settings-overlay.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeftIcon,
  XIcon,
  ServerIcon,
  SparklesIcon,
  ShieldCheckIcon,
  TerminalIcon,
  GlobeIcon,
  FolderIcon,
  MessageSquareIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  readClaudeConfig,
  type ResolvedConfig,
  type McpServerConfig,
  type SkillConfig,
  type CommandConfig,
} from "@/lib/claude-config-reader";
import { db, type ConfigOverrideRow } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScopeSelection =
  | { type: "global" }
  | { type: "workspace"; id: string; name: string; cwd: string }
  | { type: "thread"; id: string; title: string };

interface SettingsOverlayProps {
  open: boolean;
  onClose: () => void;
  workspaces: Array<{ id: string; name: string; cwd: string }>;
  currentThread?: { id: string; title: string } | null;
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-120 ease-in-out",
        checked ? "bg-primary" : "bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-4 rounded-full bg-foreground shadow-sm transition-transform duration-120 ease-in-out",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Source badge
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: "global" | "project" }) {
  return (
    <span className="inline-flex items-center rounded-full border border-input bg-[color-mix(in_srgb,var(--muted)_70%,transparent)] px-2 py-0.5 font-mono text-[0.68rem] text-muted-foreground">
      {source}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Override badge
// ---------------------------------------------------------------------------

function OverrideBadge({ label }: { label: string }) {
  return (
    <span className="text-[0.64rem] font-mono text-[var(--warning)]">
      overridden in: {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

function SectionHeader({ title, icon: Icon }: { title: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-2 pb-2 pt-4 first:pt-0">
      <Icon className="size-3.5 text-muted-foreground" />
      <h3 className="text-[0.69rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
        {title}
      </h3>
    </div>
  );
}

function McpServerItem({
  server,
  isEnabled,
  onToggle,
  readOnly,
  overrideLabel,
}: {
  server: McpServerConfig;
  isEnabled: boolean;
  onToggle?: (enabled: boolean) => void;
  readOnly?: boolean;
  overrideLabel?: string;
}) {
  const detail = server.command
    ? [server.command, ...(server.args ?? [])].join(" ")
    : server.url ?? "";

  return (
    <div className="group flex items-start gap-3 rounded-md px-2 py-2 transition-colors duration-120 hover:bg-muted/50">
      <div className="pt-0.5">
        <Toggle
          checked={isEnabled}
          onChange={(v) => onToggle?.(v)}
          disabled={readOnly}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-foreground">
            {server.name}
          </span>
          <SourceBadge source={server.source} />
        </div>
        <div className="mt-0.5 truncate font-mono text-[0.72rem] text-muted-foreground">
          {detail}
          {server.type !== "stdio" && (
            <span className="ml-2 text-[0.64rem]">type: {server.type}</span>
          )}
        </div>
        {overrideLabel && (
          <div className="mt-0.5">
            <OverrideBadge label={overrideLabel} />
          </div>
        )}
      </div>
    </div>
  );
}

function SkillItem({
  skill,
  isEnabled,
  onToggle,
  readOnly,
  overrideLabel,
}: {
  skill: SkillConfig;
  isEnabled: boolean;
  onToggle?: (enabled: boolean) => void;
  readOnly?: boolean;
  overrideLabel?: string;
}) {
  return (
    <div className="group flex items-start gap-3 rounded-md px-2 py-2 transition-colors duration-120 hover:bg-muted/50">
      <div className="pt-0.5">
        <Toggle
          checked={isEnabled}
          onChange={(v) => onToggle?.(v)}
          disabled={readOnly}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-foreground">
            {skill.name}
          </span>
          <SourceBadge source={skill.source} />
        </div>
        {skill.description && (
          <div className="mt-0.5 text-[0.8rem] text-muted-foreground">
            {skill.description}
          </div>
        )}
        {overrideLabel && (
          <div className="mt-0.5">
            <OverrideBadge label={overrideLabel} />
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionItem({
  permission,
  isEnabled,
  onToggle,
  readOnly,
}: {
  permission: string;
  isEnabled: boolean;
  onToggle?: (enabled: boolean) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-120 hover:bg-muted/50">
      <Toggle
        checked={isEnabled}
        onChange={(v) => onToggle?.(v)}
        disabled={readOnly}
      />
      <span className="font-mono text-[0.78rem] text-foreground">
        {permission}
      </span>
    </div>
  );
}

function CommandItem({ command }: { command: CommandConfig }) {
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-1.5">
      <span className="font-mono text-[0.78rem] text-foreground">
        /{command.name}
      </span>
      <SourceBadge source={command.source} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SettingsOverlay({
  open,
  onClose,
  workspaces,
  currentThread,
}: SettingsOverlayProps) {
  const [scope, setScope] = useState<ScopeSelection>({ type: "global" });
  const [config, setConfig] = useState<ResolvedConfig | null>(null);
  const [overrides, setOverrides] = useState<ConfigOverrideRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Load config when overlay opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);

    const cwds = workspaces.map((w) => w.cwd);
    readClaudeConfig(cwds)
      .then(setConfig)
      .catch((err) => console.error("[settings] config read error:", err))
      .finally(() => setLoading(false));
  }, [open, workspaces]);

  // Load overrides for current scope
  useEffect(() => {
    if (!open) return;
    if (scope.type === "global") {
      setOverrides([]);
      return;
    }
    const scopeId = scope.type === "workspace" ? scope.id : scope.id;
    db.configOverrides
      .list(scope.type, scopeId)
      .then(setOverrides)
      .catch((err) => console.error("[settings] overrides load error:", err));
  }, [open, scope]);

  // Check if an item is enabled (considering overrides)
  const isEnabled = useMemo(() => {
    const overrideMap = new Map(
      overrides.map((o) => [`${o.item_type}:${o.item_name}`, o.enabled === 1]),
    );
    return (itemType: ConfigOverrideRow["item_type"], itemName: string): boolean => {
      const key = `${itemType}:${itemName}`;
      return overrideMap.get(key) ?? true; // default enabled
    };
  }, [overrides]);

  // Toggle handler
  const handleToggle = async (
    itemType: ConfigOverrideRow["item_type"],
    itemName: string,
    enabled: boolean,
  ) => {
    if (scope.type === "global") return; // global is read-only

    const scopeId = scope.id;
    await db.configOverrides.upsert(scope.type, scopeId, itemType, itemName, enabled);

    // Refresh overrides
    const updated = await db.configOverrides.list(scope.type, scopeId);
    setOverrides(updated);
  };

  // Find override labels for global view (which workspaces/threads override this item)
  const findOverrideLabels = (_itemType: string, _itemName: string): string | undefined => {
    // For now, override labels are only shown when we implement cross-scope queries
    // This is a placeholder for future enhancement
    return undefined;
  };

  // Resolve current scope's config
  const scopeConfig = useMemo((): ConfigScope | null => {
    if (!config) return null;
    if (scope.type === "global") return config.global;
    if (scope.type === "workspace") {
      const project = config.projects.get(scope.cwd);
      // Merge global + project configs
      return {
        mcpServers: [
          ...config.global.mcpServers,
          ...(project?.mcpServers ?? []),
        ],
        skills: [...config.global.skills, ...(project?.skills ?? [])],
        permissions: [
          ...config.global.permissions,
          ...(project?.permissions ?? []),
        ],
        commands: [...config.global.commands, ...(project?.commands ?? [])],
      };
    }
    // Thread scope — show everything (global + workspace if applicable)
    return {
      mcpServers: config.global.mcpServers,
      skills: config.global.skills,
      permissions: config.global.permissions,
      commands: config.global.commands,
    };
  }, [config, scope]);

  if (!open) return null;

  const readOnly = scope.type === "global";

  return (
    <div className="fixed inset-0 z-50 flex bg-background animate-in fade-in duration-180">
      {/* Header */}
      <div className="absolute inset-x-0 top-0 z-10 flex h-10 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Close settings"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <span className="text-[0.69rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
            Settings
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close"
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      {/* Scope nav */}
      <nav className="mt-10 w-56 shrink-0 overflow-y-auto border-r border-border bg-card px-2 py-3">
        {/* Global */}
        <button
          type="button"
          onClick={() => setScope({ type: "global" })}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-120",
            scope.type === "global"
              ? "border-l-2 border-l-primary bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          <GlobeIcon className="size-3.5" />
          Global
        </button>

        {/* Workspaces */}
        {workspaces.length > 0 && (
          <>
            <div className="mt-4 px-2 text-[0.69rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              Workspaces
            </div>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() =>
                  setScope({
                    type: "workspace",
                    id: ws.id,
                    name: ws.name,
                    cwd: ws.cwd,
                  })
                }
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-120",
                  scope.type === "workspace" && scope.id === ws.id
                    ? "border-l-2 border-l-primary bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <FolderIcon className="size-3.5" />
                <span className="truncate">{ws.name}</span>
              </button>
            ))}
          </>
        )}

        {/* Current thread */}
        {currentThread && (
          <>
            <div className="mt-4 px-2 text-[0.69rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              Thread
            </div>
            <button
              type="button"
              onClick={() =>
                setScope({
                  type: "thread",
                  id: currentThread.id,
                  title: currentThread.title,
                })
              }
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-120",
                scope.type === "thread"
                  ? "border-l-2 border-l-primary bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <MessageSquareIcon className="size-3.5" />
              <span className="truncate">{currentThread.title}</span>
            </button>
          </>
        )}
      </nav>

      {/* Main panel */}
      <main className="mt-10 flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading configuration...</div>
        ) : !scopeConfig ? (
          <div className="text-sm text-muted-foreground">No configuration found.</div>
        ) : (
          <>
            {/* Scope title */}
            <div className="mb-4">
              <h2 className="text-sm font-medium text-foreground">
                {scope.type === "global" && "Global Configuration"}
                {scope.type === "workspace" && scope.name}
                {scope.type === "thread" && scope.title}
              </h2>
              {scope.type === "workspace" && (
                <p className="mt-0.5 font-mono text-[0.72rem] text-muted-foreground">
                  {scope.cwd}
                </p>
              )}
              {readOnly && (
                <p className="mt-1 text-[0.72rem] text-muted-foreground">
                  Read-only — reflects Claude Code config files on disk.
                </p>
              )}
            </div>

            {/* MCP Servers */}
            {scopeConfig.mcpServers.length > 0 && (
              <>
                <SectionHeader title="MCP Servers" icon={ServerIcon} />
                <div className="space-y-0.5">
                  {scopeConfig.mcpServers.map((server) => (
                    <McpServerItem
                      key={`${server.source}:${server.name}`}
                      server={server}
                      isEnabled={isEnabled("mcp_server", server.name)}
                      onToggle={(v) =>
                        void handleToggle("mcp_server", server.name, v)
                      }
                      readOnly={readOnly}
                      overrideLabel={findOverrideLabels("mcp_server", server.name)}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Skills */}
            {scopeConfig.skills.length > 0 && (
              <>
                <SectionHeader title="Skills" icon={SparklesIcon} />
                <div className="space-y-0.5">
                  {scopeConfig.skills.map((skill) => (
                    <SkillItem
                      key={`${skill.source}:${skill.name}`}
                      skill={skill}
                      isEnabled={isEnabled("skill", skill.name)}
                      onToggle={(v) =>
                        void handleToggle("skill", skill.name, v)
                      }
                      readOnly={readOnly}
                      overrideLabel={findOverrideLabels("skill", skill.name)}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Permissions */}
            {scopeConfig.permissions.length > 0 && (
              <>
                <SectionHeader title="Permissions" icon={ShieldCheckIcon} />
                <div className="space-y-0.5">
                  {scopeConfig.permissions.map((perm) => (
                    <PermissionItem
                      key={perm}
                      permission={perm}
                      isEnabled={isEnabled("permission", perm)}
                      onToggle={(v) =>
                        void handleToggle("permission", perm, v)
                      }
                      readOnly={readOnly}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Commands */}
            {scopeConfig.commands.length > 0 && (
              <>
                <SectionHeader title="Commands" icon={TerminalIcon} />
                <div className="space-y-0.5">
                  {scopeConfig.commands.map((cmd) => (
                    <CommandItem
                      key={`${cmd.source}:${cmd.name}`}
                      command={cmd}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Empty state */}
            {scopeConfig.mcpServers.length === 0 &&
              scopeConfig.skills.length === 0 &&
              scopeConfig.permissions.length === 0 &&
              scopeConfig.commands.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No configuration items found at this scope.
                </div>
              )}
          </>
        )}
      </main>
    </div>
  );
}
```

**Step 2: Verify types**

Run: `cd /home/user/projects/pluribus && bunx tsc --noEmit`
Expected: No type errors (may need to fix minor issues).

**Step 3: Commit**

```bash
git add src/components/settings-overlay.tsx
git commit -m "feat: add SettingsOverlay component with layered config explorer"
```

---

### Task 5: Add settings gear icon to sidebar footer

**Files:**
- Modify: `src/components/assistant-ui/thread-list.tsx:844-856` (add gear button)

**Step 1: Add state and imports**

At the top of `thread-list.tsx`, add `SettingsIcon` to the lucide imports and import the overlay. Also add state for the overlay open/close.

Add to lucide imports:
```typescript
import { SettingsIcon } from "lucide-react";
```

Add import:
```typescript
import { SettingsOverlay } from "@/components/settings-overlay";
```

Inside the `ThreadList` component, add state:
```typescript
const [settingsOpen, setSettingsOpen] = useState(false);
```

**Step 2: Add gear button to footer**

In the `.aui-sidebar-footer` div (line 844), change the footer to include the settings button alongside the "Add workspace" button:

Replace the footer structure so the "Add workspace" and gear icon sit in a flex row:

```tsx
<div className="aui-sidebar-footer border-t border-border">
  <div className="flex items-center gap-1">
    <Button
      variant="ghost"
      className="h-8 flex-1 justify-start gap-2 px-2 text-sm"
      onClick={() => {
        setShowWorkspaceForm((prev) => !prev);
        setError(null);
        setWorkspaceCreationError(null);
      }}
    >
      <FolderPlusIcon className="size-4" />
      Add workspace
    </Button>
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => setSettingsOpen(true)}
      aria-label="Settings"
      title="Settings"
    >
      <SettingsIcon className="size-4" />
    </Button>
  </div>
  {/* ... rest of workspace form stays the same */}
```

**Step 3: Render the SettingsOverlay**

At the end of the ThreadList component's return, just before the final closing tags, add:

```tsx
<SettingsOverlay
  open={settingsOpen}
  onClose={() => setSettingsOpen(false)}
  workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, cwd: w.cwd }))}
  currentThread={/* current thread from aui context, or null */}
/>
```

Note: Getting the current thread requires accessing assistant-ui's runtime context. Check what hooks are available — likely `useThreadListRuntime()` provides the active thread ID. The thread title and ID can then be looked up from the thread list state already in scope.

**Step 4: Verify types and visual**

Run: `cd /home/user/projects/pluribus && bunx tsc --noEmit`
Then: `cargo tauri dev` to visually verify the gear icon appears in the sidebar footer.

**Step 5: Commit**

```bash
git add src/components/assistant-ui/thread-list.tsx
git commit -m "feat: add settings gear icon to sidebar footer with overlay trigger"
```

---

### Task 6: Add overlay CSS for animation and scrollbar

**Files:**
- Modify: `src/App.css` (add settings overlay styles)

**Step 1: Add styles**

At the end of `src/App.css`, add:

```css
/* ---------------------------------------------------------------------------
 * Settings overlay
 * --------------------------------------------------------------------------- */

.settings-overlay-nav {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.settings-overlay-main {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}
```

Note: The `animate-in fade-in duration-180` classes in the component use Tailwind's animation utilities. If these don't exist in the Tailwind v4 config, fall back to a custom keyframe:

```css
@keyframes settings-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.settings-fade-in {
  animation: settings-fade-in 180ms ease;
}
```

**Step 2: Commit**

```bash
git add src/App.css
git commit -m "feat: add settings overlay CSS styles"
```

---

### Task 7: Wire up current thread context to settings overlay

**Files:**
- Modify: `src/components/assistant-ui/thread-list.tsx` (pass current thread to overlay)

**Step 1: Get current thread info from assistant-ui context**

The ThreadList component already has access to thread data. Check what's available:

- The component uses `useThreadListRuntime()` which provides `threadListRuntime.getState().threadIds`, `threadListRuntime.getState().mainThreadId`
- Thread rows are rendered from the workspace/thread data structures already in scope
- The active thread can be determined from assistant-ui's state

Look for the active thread ID pattern in the existing code and pass it as:

```tsx
const activeThreadId = /* from aui runtime state */;
const activeThread = /* lookup from threads array */;

<SettingsOverlay
  open={settingsOpen}
  onClose={() => setSettingsOpen(false)}
  workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, cwd: w.cwd }))}
  currentThread={activeThread ? { id: activeThread.id, title: activeThread.title ?? "Untitled" } : null}
/>
```

**Step 2: Verify end-to-end**

Run: `cargo tauri dev`
- Click the gear icon in the sidebar footer
- Settings overlay should appear with "Global" selected
- MCP servers, skills, permissions should be listed
- Click a workspace — should show merged global + project items
- Toggle an item — should persist (check with SQLite browser or re-open settings)

**Step 3: Commit**

```bash
git add src/components/assistant-ui/thread-list.tsx
git commit -m "feat: wire current thread context to settings overlay"
```

---

### Task 8: Visual polish and design language compliance

**Files:**
- Modify: `src/components/settings-overlay.tsx` (any visual fixes after first render)

**Step 1: Review against design language**

Open `cargo tauri dev` and compare the settings overlay against `docs/design-language.md`:

- [ ] Background is `#111114` (the void)
- [ ] Scope nav uses `#1a1a1f` (card) background
- [ ] Active scope has 2px amber left border + muted background
- [ ] Section labels are uppercase, 0.69rem, weight 600, 0.11em tracking
- [ ] Item names are monospace
- [ ] Source badges are mono pills with `var(--input)` border
- [ ] Toggle amber when on, muted when off
- [ ] No shadows, no gradients anywhere
- [ ] Scrollbars are thin and unobtrusive
- [ ] Icons are 14px, stroked, muted-foreground
- [ ] Hover states use 120ms ease transitions

**Step 2: Fix any discrepancies found during visual review**

Adjust Tailwind classes as needed to match the design language exactly.

**Step 3: Commit**

```bash
git add src/components/settings-overlay.tsx src/App.css
git commit -m "style: polish settings overlay to match design language"
```

---

## Task Dependency Graph

```
Task 1 (migration) ──→ Task 2 (db ops) ──→ Task 4 (overlay component)
                                                    ↓
Task 3 (config reader) ──────────────────→ Task 4
                                                    ↓
                                           Task 5 (gear icon + wiring)
                                                    ↓
                                           Task 6 (CSS)
                                                    ↓
                                           Task 7 (thread context)
                                                    ↓
                                           Task 8 (visual polish)
```

Tasks 1, 2, 3 can be done in parallel (no dependencies between migration, db ops, and config reader — except Task 2 needs Task 1's table to exist at runtime).

---

## Key References

- **Design language:** `docs/plans/2026-02-18-settings-page-design.md` and `docs/design-language.md`
- **Shell command pattern:** `src/lib/workspace-repo-metadata.ts:128` — `Command.create("claude-stream-sh", ["-c", ...])`
- **DB operation pattern:** `src/lib/db.ts` — parameterized queries with `$1, $2`, `getDb()` singleton
- **Migration pattern:** `src-tauri/src/lib.rs:10-41` — `Migration { version, description, sql, kind }`
- **Button API:** `src/components/ui/button.tsx` — variants: ghost, sizes: icon-xs
- **Sidebar footer:** `src/components/assistant-ui/thread-list.tsx:844-856`
- **Config file locations:** `~/.claude/settings.json`, `~/.claude/plugins/**/.mcp.json`, `~/.claude/skills/*/SKILL.md`, `<project>/.claude/settings.local.json`
