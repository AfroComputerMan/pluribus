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
  const pathParts = sourcePath.split("/");
  const name = nameMatch?.[1]?.trim() ?? pathParts[pathParts.length - 2] ?? "unknown";
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
    const fileName = parts[parts.length - 1] ?? "";
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
    const fileName = parts[parts.length - 1] ?? "";
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
