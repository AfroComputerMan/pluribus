# Settings Page Design — Claude Code Config Explorer

> Date: 2026-02-18
> Status: Approved

---

## Overview

A full-screen overlay settings page for Pluribus that reads Claude Code configuration files from disk and presents them in a layered, navigable UI. Users can view all MCP servers, skills, permissions, and commands at the global level, then toggle items on/off per-workspace and per-thread using a non-destructive override layer stored in Pluribus's SQLite database.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Access pattern | Full-screen overlay | Enough space for config hierarchy; matches IDE settings pattern |
| Edit model | Read + toggle | Non-destructive. Overrides stored in Pluribus DB, not on disk |
| Scope levels | Global → Workspace → Thread | Maps to Claude Code's inheritance model |
| Entry point | Gear icon in sidebar footer | Discoverable, always accessible, consistent with existing UI |
| Data source | Tauri fs plugin | Direct file reads, always up-to-date |

---

## Data Model

### Config Sources (read from disk)

| Source | Path | Provides |
|--------|------|----------|
| Global settings | `~/.claude/settings.json` | Permissions, enabled plugins |
| Global local | `~/.claude/settings.local.json` | Additional permissions |
| MCP configs | `~/.claude/plugins/marketplaces/**/.mcp.json` | MCP server definitions |
| Global skills | `~/.claude/skills/*/SKILL.md` | Skill manifests |
| Global commands | `~/.claude/commands/**/*.md` | Slash commands |
| Project settings | `<workspace-dir>/.claude/settings.local.json` | Per-project permissions |
| Project skills | `<workspace-dir>/.claude/skills/*/SKILL.md` | Per-project skills |
| Project MCP | `<workspace-dir>/.mcp.json` | Per-project MCP servers |

### TypeScript Types

```typescript
interface McpServer {
  name: string;
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  source: "global" | "project";
}

interface Skill {
  name: string;
  description: string;
  allowedTools: string[];
  source: "global" | "project";
}

interface ConfigScope {
  mcpServers: McpServer[];
  skills: Skill[];
  permissions: string[];
  commands: string[];
}

interface ResolvedConfig {
  global: ConfigScope;
  projects: Map<string, ConfigScope>;
}
```

### Override Layer (SQLite)

```sql
CREATE TABLE config_overrides (
  id INTEGER PRIMARY KEY,
  scope_type TEXT NOT NULL,          -- 'workspace' | 'thread'
  scope_id TEXT NOT NULL,            -- workspace ID or thread ID
  item_type TEXT NOT NULL,           -- 'mcp_server' | 'skill' | 'permission'
  item_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(scope_type, scope_id, item_type, item_name)
);
```

---

## UI Design

### Layout

Full-screen overlay on `var(--background)` (#111114).

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back     SETTINGS                                    ×   │
├──────────────┬──────────────────────────────────────────────┤
│  SCOPE NAV   │  MAIN PANEL                                  │
│  w-56        │                                              │
│  bg: card    │  Sections: MCP Servers, Skills,              │
│  border-r    │  Permissions, Commands                       │
│              │                                              │
│  ● Global    │  Each item: toggle + name + source badge     │
│              │  + metadata line + override indicator         │
│  WORKSPACES  │                                              │
│  ○ pluribus  │                                              │
│  ○ dotfiles  │                                              │
│              │                                              │
│  THREAD      │                                              │
│  ○ Current   │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

### Design Language Alignment

| Element | Token/Value |
|---------|------------|
| Overlay bg | `var(--background)` #111114 |
| Scope nav bg | `var(--card)` #1a1a1f |
| Active scope | `var(--muted)` bg + 2px `var(--primary)` left border |
| Section labels | Uppercase, 0.69rem, 600, tracking 0.11em, `var(--muted-foreground)` |
| Item names | Mono, `var(--foreground)` |
| Source badges | Mono pill, 0.68rem, `var(--muted-foreground)`, border `var(--input)` |
| Toggle on | `var(--primary)` amber |
| Toggle off | `var(--muted)` |
| Descriptions | Sans, 0.875rem, `var(--muted-foreground)` |
| Override badge | `var(--warning)` text |
| Icons | Lucide, 14px, stroked, `var(--muted-foreground)` |
| No shadows, no gradients | Flat throughout |

### Scope Behavior

| Scope | Shows | Toggleable |
|-------|-------|-----------|
| Global | All global MCP, skills, perms, commands | Read-only (reflects disk state) |
| Workspace | Global inherited + local items. Badges: "inherited" / "local" | Toggle any on/off (DB override) |
| Thread | Resolved effective state (global + workspace + thread overrides) | Toggle any on/off (DB override) |

### Config Item Row

```
[toggle]  item-name                        [source: global]
          command/description text              type: stdio
          └─ overridden in: workspace-name
```

- Toggle: left, custom switch (amber on)
- Name: mono, weight 500
- Source: right-aligned mono pill
- Details: mono, muted
- Override indicator: shown on Global view when downstream overrides exist

---

## Entry Point

Gear icon (`Settings` from Lucide) in sidebar footer, next to "Add workspace" button. Ghost button style, `var(--muted-foreground)`, brightens on hover.

### Overlay Transition

Fade-in 180ms ease. No slide animation (per design language: functional motion only).

---

## What This Does NOT Include

- Editing actual config files on disk
- Creating new MCP servers or skills
- Managing Claude Code credentials or auth
- Theme or appearance settings (there is no light mode)
- Keybinding configuration
