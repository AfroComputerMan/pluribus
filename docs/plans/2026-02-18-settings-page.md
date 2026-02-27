# Settings Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the existing settings overlay from a sidebar + vertical list layout to a tabbed card grid layout. The data model, config reader, and SQLite override layer are already implemented — this plan covers only the UI redesign.

**What already exists:**
- `src/components/settings-overlay.tsx` — current sidebar + list implementation
- `src/lib/claude-config-reader.ts` — reads Claude Code config from disk
- `src/lib/db.ts` — config_overrides CRUD operations
- `src-tauri/migrations/006_config_overrides.sql` — SQLite schema
- Sidebar gear icon entry point in `thread-list.tsx`

**Design doc:** `docs/plans/2026-02-18-settings-page-design.md` (v2 — card grid redesign)

---

### Task 1: Refactor SettingsOverlay — replace sidebar with header scope dropdown

**Files:**
- Modify: `src/components/settings-overlay.tsx`

**What to change:**
1. Remove the entire `<nav>` sidebar element (the `settings-overlay-nav` section)
2. Replace it with a scope dropdown in the header bar, positioned between the "SETTINGS" label and the close button
3. The dropdown should be a button styled as `aui-composer-chip` that opens a popover (use Radix `Popover` from `@/components/ui/popover`)
4. The popover content should list: Global, then Workspaces section, then Thread section — styled like `aui-model-popover`
5. Remove the `w-56 shrink-0` sidebar layout — the main panel should now be `flex-1` taking full width
6. Remove the `mt-10` from main since layout changes

**Design reference:**
- Header: `[<-] SETTINGS [scope-chip v] [x]`
- Scope chip shows icon + scope name: `GlobeIcon Global`, `FolderIcon pluribus`, etc.
- Popover styled like the model selection popover (bg-card, border, rounded-lg, mono font)

**Verify:** `bunx tsc --noEmit` — no type errors

---

### Task 2: Add tab bar for section navigation

**Files:**
- Modify: `src/components/settings-overlay.tsx`

**What to change:**
1. Add a `TabSection` type: `"mcp_servers" | "skills" | "permissions" | "commands"`
2. Add `activeTab` state, defaulting to `"mcp_servers"`
3. Render a tab bar between the header and the main content area
4. Each tab shows: icon + label + count in parens
   - MCP Servers (12) — `ServerIcon`
   - Skills (8) — `SparklesIcon`
   - Permissions (5) — `ShieldCheckIcon`
   - Commands (3) — `TerminalIcon`
5. Active tab: `text-foreground` with 2px bottom border in `var(--primary)`
6. Inactive: `text-muted-foreground`, hover brightens
7. Tabs with 0 items: shown but with `opacity-40`
8. Tab bar height: ~36px, left-aligned tabs, mono font 0.72rem

**Verify:** `bunx tsc --noEmit` — no type errors

---

### Task 3: Replace item lists with responsive card grid

**Files:**
- Modify: `src/components/settings-overlay.tsx`

**What to change:**
1. Replace the `SectionHeader` + `space-y-0.5` list pattern with a CSS grid
2. Grid: `grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2`
3. Only render the section matching `activeTab` (not all sections at once)

4. **McpServerCard** — replaces `McpServerItem`:
   - `bg-card border border-border rounded-lg p-2.5`
   - Top row: name (mono, sm, medium) + Toggle (flex justify-between)
   - Bottom row: source text + " . " + type (mono, 0.68rem, muted)
   - When disabled: `opacity-50` on the card
   - Hover: subtle border/bg change
   - Tooltip on name: shows full command/URL

5. **SkillCard** — replaces `SkillItem`:
   - Same card structure, name + toggle on top, source on bottom
   - Description in tooltip only (not on card face)

6. **PermissionCard** — replaces `PermissionItem`:
   - Permission string as name, toggle below/inline
   - No source badge

7. **CommandCard** — replaces `CommandItem`:
   - Slash-prefixed name, source below
   - No toggle (display-only)

**Verify:** `bunx tsc --noEmit` && `cargo tauri dev` for visual check

---

### Task 4: Add tooltip for card details

**Files:**
- Modify: `src/components/settings-overlay.tsx`

**What to change:**
1. Import `Tooltip` from `@/components/ui/tooltip`
2. Wrap card names in `TooltipTrigger` with `TooltipContent` showing:
   - MCP servers: full command + args or URL
   - Skills: description text
   - Permissions: no tooltip needed (full string shown on card)
   - Commands: no tooltip needed

**Verify:** `cargo tauri dev` — hover over cards, tooltips appear

---

### Task 5: Update App.css for card grid styles

**Files:**
- Modify: `src/App.css`

**What to change:**
1. Remove the `.settings-overlay-nav` styles (sidebar no longer exists)
2. Keep `.settings-overlay-main` scrollbar styles
3. Add card grid specific styles if needed (most should be Tailwind utility classes)

**Verify:** Visual check in `cargo tauri dev`

---

### Task 6: Visual polish and design language compliance

**Files:**
- Modify: `src/components/settings-overlay.tsx`
- Modify: `src/App.css` (if needed)

**Checklist:**
- [ ] Background is `#111114` (the void)
- [ ] Cards use `#1a1a1f` (card) background
- [ ] Active tab has 2px amber bottom border
- [ ] Tab labels are mono, 0.72rem
- [ ] Card names are monospace, sm, medium weight
- [ ] Source text is mono, 0.68rem, muted-foreground
- [ ] Toggle amber when on, muted when off
- [ ] No shadows, no gradients
- [ ] Scrollbars thin and unobtrusive
- [ ] Hover states use 120ms ease transitions
- [ ] Cards at ~180px min width, auto-fill responsive
- [ ] Grid gap is 0.5rem

**Verify:** `cargo tauri dev` — full visual review

---

## Task Dependency Graph

```
Task 1 (header dropdown) ──> Task 2 (tab bar) ──> Task 3 (card grid)
                                                        |
                                                        v
                                                  Task 4 (tooltips)
                                                        |
                                                        v
                                                  Task 5 (CSS cleanup)
                                                        |
                                                        v
                                                  Task 6 (visual polish)
```

All tasks are sequential — each builds on the previous.

---

## Key References

- **Design doc:** `docs/plans/2026-02-18-settings-page-design.md` (v2)
- **Current implementation:** `src/components/settings-overlay.tsx`
- **Config reader:** `src/lib/claude-config-reader.ts`
- **DB operations:** `src/lib/db.ts` — `db.configOverrides.*`
- **Card component:** `src/components/ui/card.tsx`
- **Tooltip component:** `src/components/ui/tooltip.tsx`
- **Popover component:** `src/components/ui/popover.tsx`
- **Badge component:** `src/components/ui/badge.tsx`
- **Design tokens:** `src/App.css` (CSS custom properties)
- **Model popover pattern:** `.aui-model-popover` in `src/App.css`
- **Composer chip pattern:** `.aui-composer-chip` in `src/App.css`
