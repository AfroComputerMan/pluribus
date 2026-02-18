# Settings Page Design — Claude Code Config Explorer

> Date: 2026-02-18
> Status: Approved (v2 — card grid redesign)

---

## Overview

A full-screen overlay settings page for Pluribus that reads Claude Code configuration files from disk and presents them in a layered, navigable UI. Users can view all MCP servers, skills, permissions, and commands at the global level, then toggle items on/off per-workspace and per-thread using a non-destructive override layer stored in Pluribus's SQLite database.

### v2 Changes (Card Grid Redesign)

The original v1 design used a sidebar scope nav + vertical list of items. This caused excessive scrolling with many MCP servers/skills. The v2 redesign:
- Replaces the sidebar scope nav with a **header dropdown** (reclaims horizontal space)
- Replaces the vertical item list with a **tabbed section view** (MCP Servers | Skills | Permissions | Commands)
- Replaces individual item rows with a **responsive card grid** (3-5 columns)
- Uses compact cards that show name, source, type, and toggle — details on hover/tooltip

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Access pattern | Full-screen overlay | Enough space for config hierarchy; matches IDE settings pattern |
| Edit model | Read + toggle | Non-destructive. Overrides stored in Pluribus DB, not on disk |
| Scope levels | Global > Workspace > Thread | Maps to Claude Code's inheritance model |
| Entry point | Gear icon in sidebar footer | Discoverable, always accessible, consistent with existing UI |
| Data source | Tauri shell plugin | Direct file reads, always up-to-date |
| **Section navigation** | **Tabbed sections** | **Eliminates scrolling; each tab shows one section as a card grid** |
| **Scope selector** | **Header dropdown** | **Reclaims sidebar width for card grid columns** |
| **Item display** | **Compact card grid** | **3-5 columns, ~180px min card width, auto-fill responsive** |

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
interface McpServerConfig {
  name: string;
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  source: "global" | "project";
  sourcePath: string;
}

interface SkillConfig {
  name: string;
  description: string;
  source: "global" | "project";
  sourcePath: string;
}

interface CommandConfig {
  name: string;
  fileName: string;
  source: "global" | "project";
}

interface ConfigScope {
  mcpServers: McpServerConfig[];
  skills: SkillConfig[];
  permissions: string[];
  commands: CommandConfig[];
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
  item_type TEXT NOT NULL,           -- 'mcp_server' | 'skill' | 'permission' | 'command'
  item_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(scope_type, scope_id, item_type, item_name)
);
```

---

## UI Design (v2 — Tabbed Card Grid)

### Overall Layout

Full-screen overlay on `var(--background)` (#111114). No sidebar — full width used for cards.

```
+----------------------------------------------------------------------+
| [<-]  SETTINGS    [ Global v ]                                  [x]  |  <- Header (40px)
+----------------------------------------------------------------------+
|  MCP Servers (12)  |  Skills (8)  |  Permissions (5)  |  Commands (3) |  <- Tab bar (36px)
+----------------------------------------------------------------------+
|                                                                      |
|  +------------------+ +------------------+ +------------------+      |
|  | * tavily    [==] | | * serena    [==] | | * context7  [==] |      |
|  | global . stdio   | | project . stdio  | | global . http    |      |
|  +------------------+ +------------------+ +------------------+      |
|                                                                      |
|  +------------------+ +------------------+ +------------------+      |
|  | * playwright[==] | | * obsidian  [==] | | * chrome-dt [==] |      |
|  | global . stdio   | | global . http    | | global . stdio   |      |
|  +------------------+ +------------------+ +------------------+      |
|                                                                      |
|  +------------------+ +------------------+                           |
|  | * gamma     [==] | | * hf        [==] |                           |
|  | global . http    | | global . http    |                           |
|  +------------------+ +------------------+                           |
|                                                                      |
+----------------------------------------------------------------------+
```

### Header Bar (40px)

- **Back arrow** + **"SETTINGS"** label (0.69rem uppercase, 0.11em tracking, `--muted-foreground`)
- **Scope dropdown** — styled as a chip/pill (matches `aui-composer-chip`):
  - Globe icon + "Global" (default)
  - Folder icon + workspace name (when workspace selected)
  - MessageSquare icon + thread title (when thread selected)
  - Clicking opens a popover styled like `aui-model-popover`
- **Close [x]** on the right (ghost button)

When a non-global scope is selected, a subtle indicator shows:
- Global: "Read-only" text next to dropdown
- Workspace/Thread: no extra indicator (toggles are obviously active)

### Scope Dropdown Popover

Styled identically to the existing model selection popover (`aui-model-popover`):

```
+---------------------------+
| * Global                  |  <- GlobeIcon, always present
|                           |
| WORKSPACES                |  <- Section header
|   o pluribus              |  <- FolderIcon + name
|   o dotfiles              |
|                           |
| THREAD                    |  <- Section header (if thread exists)
|   o Current thread title  |  <- MessageSquareIcon + title
+---------------------------+
```

- Active scope: `text-foreground` with primary-colored dot
- Inactive: `text-muted-foreground`, hover brightens
- Font: `--app-font-mono`, 0.68rem (matching model popover)

### Tab Bar (36px)

Horizontal tabs below the header:

- Left-aligned, monospace font, 0.72rem
- Active tab: `text-foreground` + 2px bottom border in `var(--primary)` (amber)
- Inactive tabs: `text-muted-foreground`, hover `text-foreground`
- Count shown in parens: `text-muted-foreground`
- Tabs with 0 items: still shown but dimmed (`opacity-40`)
- Tab order: MCP Servers | Skills | Permissions | Commands

### Card Grid

CSS Grid with `grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))`:
- 3-5 columns depending on window width
- Gap: `0.5rem` (8px)
- Padding: `1rem 1.5rem` (16px 24px)

#### MCP Server Card

```
+---------------------+
| * serena       [==] |  <- name (mono, sm, medium) + toggle (top-right)
| project . stdio     |  <- source badge text + type
+---------------------+
```

- Background: `bg-card` (#1a1a1f)
- Border: `border border-border` (rgba white 8%)
- Radius: `rounded-lg`
- Padding: `p-2.5`
- Name: `font-mono text-sm font-medium text-foreground`
- Source + type: `font-mono text-[0.68rem] text-muted-foreground`
- Source shown as inline text (not a pill badge — saves vertical space)
- Toggle: positioned top-right with flexbox
- Disabled state (when item is toggled off): `opacity-50` on the entire card
- Hover: `border-border/80` or subtle background shift
- Tooltip on name hover: shows full command/URL string

#### Skill Card

Same structure as MCP server card:
```
+---------------------+
| frontend-design[==] |
| project              |
+---------------------+
```

- No description shown on card (tooltip only) — keeps cards uniform height
- Icon: SparklesIcon equivalent via the source text differentiation

#### Permission Card

```
+---------------------+
| Bash(npm install)   |
|               [==]  |
+---------------------+
```

- Permission string as the card "name"
- Toggle below or inline-right
- No source badge (permissions don't have a source concept in the same way)

#### Command Card

```
+---------------------+
| /commit             |
|   global            |
+---------------------+
```

- Slash prefix on name
- Source shown below
- No toggle (commands are display-only)

### Empty States

Per-tab empty state when a section has 0 items:
```
No MCP servers configured at this scope.
```

Centered, `text-sm text-muted-foreground`, padding `py-12`.

### Design Language Alignment

| Element | Token/Value |
|---------|------------|
| Overlay bg | `var(--background)` #111114 |
| Card bg | `var(--card)` #1a1a1f |
| Active tab | `text-foreground` + 2px `var(--primary)` bottom border |
| Inactive tab | `text-muted-foreground` |
| Tab bar font | Mono, 0.72rem |
| Card names | Mono, 0.875rem, weight 500 |
| Card metadata | Mono, 0.68rem, `var(--muted-foreground)` |
| Source text | Mono, 0.68rem, `var(--muted-foreground)` |
| Toggle on | `var(--primary)` amber |
| Toggle off | `var(--muted)` |
| Card border | `var(--border)` rgba white 8% |
| Card radius | `rounded-lg` |
| Grid gap | 0.5rem |
| Min card width | 180px |
| Icons | Lucide, 14px, stroked, `var(--muted-foreground)` |
| No shadows, no gradients | Flat throughout |
| Hover transitions | 120ms ease |
| Scrollbars | thin, rgba white 18% |

### Scope Behavior (unchanged from v1)

| Scope | Shows | Toggleable |
|-------|-------|-----------|
| Global | All global MCP, skills, perms, commands | Read-only (reflects disk state) |
| Workspace | Global inherited + local items | Toggle any on/off (DB override) |
| Thread | Resolved effective state | Toggle any on/off (DB override) |

---

## Entry Point (unchanged from v1)

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
