# Pluribus Design Language

> A terminal-native aesthetic for multitasking with AI.
> Inspired by [Conductor](https://www.conductor.build/) and the tactile density of terminal emulators.

---

## 1. Philosophy

### Core Principles

**Information is king.** Every pixel serves a purpose. If a visual element does not help the user understand state, navigate, or act, it does not belong. The interface should feel like a well-configured terminal — dense, flat, honest, and fast.

**Restrained warmth.** The palette is cold and dark, but not sterile. A single warm accent (amber) provides orientation without decoration. Color is a signal, never an ornament.

**Disappearing chrome.** Borders, backgrounds, and containers are nearly invisible. Content floats on the void. Structure is implied by whitespace and alignment, not drawn with lines.

**Programmatic legibility.** Monospace is the language of truth — file paths, commands, timings, branch names, and metadata all render in mono. Proportional text is for human prose only.

---

## 2. Color System

### Background Layers

The palette uses only 3-4 background shades. Contrast between layers is minimal — just enough to establish depth without creating visual noise.

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#111114` | App canvas — the void |
| `--card` | `#1a1a1f` | Sidebar panels, composer, elevated surfaces |
| `--muted` | `#27272d` | Hover states, active rows, grouped content |
| `--surface-code` | `#141419` | Code blocks, scratchpad, embedded terminals |

### Foreground / Text

| Token | Value | Usage |
|-------|-------|-------|
| `--foreground` | `#e4e4e7` | Primary text (prose, headings) |
| `--muted-foreground` | `#8b8b96` | Secondary text (timestamps, metadata, labels) |
| `--faint` | `rgba(255,255,255,0.45)` | Tertiary text (placeholder, disabled) |

### Accent Colors

Color is used **exclusively for meaning**. There is no decorative color.

| Token | Value | Role |
|-------|-------|------|
| `--primary` (amber) | `#e8a849` | Active state indicator, user message tint, focus ring, brand mark. The ONE warm color. |
| `--accent` (teal) | `#4ec9b0` | Live/connected status, success confirmation, secondary emphasis. Cool counterpoint. |
| `--destructive` (red) | `#f04444` | Errors, failed operations, destructive actions |
| `--warning` (amber/red blend) | `#d97706` | Warnings, permission prompts, attention needed |

### Borders

Borders are nearly invisible. They exist to provide structural affordance at the edge of perception.

| Token | Value | Usage |
|-------|-------|-------|
| `--border` | `rgba(255,255,255,0.08)` | Panel dividers, card edges |
| `--input` | `rgba(255,255,255,0.10)` | Input field borders, interactive element outlines |
| `--border-emphasis` | `rgba(255,255,255,0.15)` | Focus states, prominent separators |

### Color Usage Rules

1. **No gradients.** Ever. This is a flat interface.
2. **No shadows.** Depth is conveyed through background shade differences only.
3. **No colored backgrounds** except user messages (amber 8% tint) and error states.
4. **Accent left-border** (2px `--primary`) is the only decorative pattern — used for active thread, reasoning blocks, and permission bars. This is our signature visual motif.
5. **Teal is reserved** for live-state indicators (connected dot, running status). Never use it for decoration.
6. **Amber is reserved** for user-initiated elements (user messages, active states, primary CTA). Never use it for informational displays.

---

## 3. Typography

### Font Stack

```
Sans:  "IBM Plex Sans", "Inter", system-ui, sans-serif
Mono:  "IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace
```

IBM Plex was chosen for its industrial, engineered feel — it reads as "programmatic" without being cold. It pairs well with monospace in dense layouts because both families share similar x-heights and stroke weights.

### Type Scale

Text sizes are intentionally small. This is a power-user tool, not a consumer app. Everything skews 1-2 stops smaller than typical web UI.

| Role | Size | Weight | Font |
|------|------|--------|------|
| Section label (sidebar headers) | `0.69rem` (11px) | 600 | Sans, uppercase, `letter-spacing: 0.11em` |
| Metadata (timestamps, tokens, counts) | `0.64-0.68rem` (10-11px) | 400 | **Mono** |
| Body text (messages, descriptions) | `0.875-0.9rem` (14px) | 400 | Sans |
| Workspace/thread title | `0.78rem` (12.5px) | 500 | Sans |
| Heading (markdown h1) | `1rem` (16px) | 600 | Sans |
| Code (inline & blocks) | `0.8rem` / `11px` in tool display | 400 | Mono |

### Typography Rules

1. **Uppercase** is used only for section labels (WORKSPACES, SCRATCHPAD). Never for content or buttons.
2. **Bold** is used sparingly — only for markdown headings and emphasis. Never for UI labels.
3. **Monospace for all machine-produced text**: file paths, git branches, command strings, token counts, durations, code. If a human didn't type it in prose form, it's mono.
4. **Letter spacing** is widened only on uppercase labels (`0.08-0.11em`). Normal text uses default tracking.
5. **Line height** is `1.5` for prose, `1.3-1.4` for compact UI elements, `1.6-1.7` for code blocks.

---

## 4. Spacing & Layout

### Grid Structure

The app uses a 3-column grid. Sidebars are narrow (240px) and collapsible. The center column is the conversation — it takes all remaining space.

```
┌──────────┬────────────────────────────────┬──────────┐
│ Workspace│          Thread / Chat          │ Scratch- │
│ Nav      │                                 │ pad      │
│ 240px    │         minmax(0, 1fr)          │ 240px    │
└──────────┴────────────────────────────────┴──────────┘
```

Both sidebars collapse to `0px` with a 150ms ease transition. On mobile (<1024px), sidebars are hidden entirely.

### Spacing Scale

Spacing uses Tailwind's default scale. Prefer the lower end.

| Context | Typical spacing |
|---------|----------------|
| Between tool call items | `0.15rem` (2px) — nearly touching |
| Within compact groups | `0.25-0.5rem` (4-8px) |
| Between message blocks | `0.75-1rem` (12-16px) |
| Panel padding | `0.5-0.75rem` (8-12px) |
| Section separation | `1-1.5rem` (16-24px) |

### Spacing Rules

1. **Tighter than you think.** Default to less space. Information density is a feature.
2. **No padding on assistant messages.** They flow directly into the content stream with minimal `0.5rem` horizontal padding.
3. **User messages get contained padding** (`py-2.5 px-4`) because they have a background tint.
4. **Sidebar content is compact** — thread rows have minimal padding, workspace cards are separated by hairline borders only.

---

## 5. Component Patterns

### Messages

**User messages** are the ONLY element with a colored background. They receive a barely-visible amber tint to distinguish them from assistant text.

```
Background:  rgba(232, 168, 73, 0.08)   — 8% amber
Border:      1px solid rgba(232, 168, 73, 0.12) — 12% amber
Radius:      0.5rem
```

**Assistant messages** have NO background, NO border. They are plain text on the void. This is intentional — the assistant's content should feel like it's part of the environment, not contained in a bubble.

### Tool Calls

Tool calls are the heartbeat of the AI working. They should be **compact, scannable, and inline** — not bulky expandable cards.

Each tool call is a single row:

```
[icon]  Description text   [monospace-chip: file/command]
```

- **Icon**: Small (12-14px), muted color, indicates tool type (document, terminal, git, etc.)
- **Description**: Regular sans text, concise (`Read 33 lines`, `Rename to cbh123/...`)
- **Code chip**: Inline monospace label with subtle background for file paths or commands

Tool calls stack vertically with near-zero gap (`0.15rem`). They are collapsible but **collapsed by default** for tool output/results. The trigger line is always visible.

Status indication on tool calls:
- **Running**: Subtle spin animation on icon
- **Complete**: No special indicator (default state)
- **Error**: Red-tinted icon and text (`red-300/80`)
- **Warning**: Amber-tinted icon (`amber-300/80`)

### Code Blocks

```
Header:   rounded-t-lg, border, bg-muted/50, monospace filename
Body:     rounded-b-lg, border, bg-muted/30, monospace content
Font:     11px mono, relaxed line-height
```

Syntax highlighting uses a restrained palette:
- Keys/properties: `amber-200`
- Strings: `emerald-200`
- Numbers: `cyan-200`
- Booleans/null: `amber (primary)/90`
- Added lines (diff): `emerald-200`
- Removed lines (diff): `red-200`

### Inline Code

Small monospace pill: `rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[0.85em]`

### Composer (Input Area)

The composer sits at the bottom of the thread area. It is a contained element with card-level elevation.

```
Background:  var(--card)      — #1a1a1f
Border:      1px solid var(--input)
Radius:      0.75rem
```

The send button uses `--primary` (amber) — this is the primary CTA and one of the few places amber appears at full strength. All other buttons in the composer are ghost/transparent.

### Sidebar Navigation

**Thread list rows** are borderless. Structure comes from hover/active state backgrounds only.

- Default: transparent
- Hover: `var(--muted)` background, 120ms ease
- Active: `var(--muted)` background + 2px `--primary` left border

Thread row actions (delete, rename) are **hidden by default** and fade in on hover (`opacity: 0 → 1`, 120ms).

**Workspace cards** are separated by hairline borders (`1px solid var(--border)`) — no backgrounds, no rounded corners. Workspace count badges are monospace pills.

### Buttons

| Variant | Style |
|---------|-------|
| Primary (send, confirm) | `bg-primary text-primary-foreground`, hover: `brightness(1.06)` |
| Ghost (most toolbar actions) | Transparent, `text-muted-foreground`, hover: `bg-muted` + `text-foreground` |
| Destructive | `bg-destructive text-foreground` |
| Outline | `border-input bg-transparent`, hover: `bg-input/50` |

Buttons should be small. Default height is `h-8` or `h-9`. Use `h-6` (xs) for inline/toolbar actions. Icon-only buttons are common — use them freely for density.

### Chips / Badges

Chips are monospace pills used for git branches, file paths, session IDs, and other machine metadata.

```
border-radius: 999px (full pill)
border:        1px solid var(--input)
background:    color-mix(in srgb, var(--muted) 70%, transparent)
font:          var(--app-font-mono), 0.68rem
color:         var(--muted-foreground)
```

A chip may include a small colored dot (teal for active/live, amber for user-owned, red for error).

### Reasoning / Thinking Blocks

Collapsible blocks for AI reasoning. They use the **signature left-border pattern**:

```
border:       1px solid var(--border)
border-left:  2px solid var(--primary)   ← amber accent stripe
background:   color-mix(in srgb, var(--muted) 70%, transparent)
```

Summary text is muted (`0.74rem`, `--muted-foreground`). Expandable.

### Permission / Approval Bars

Same left-border pattern as reasoning blocks but with higher opacity card background:

```
border-left:  2px solid var(--primary)
background:   color-mix(in srgb, var(--card) 92%, transparent)
```

---

## 6. Iconography

**Library**: Lucide icons exclusively. No custom icons, no emoji in UI chrome.

### Rules

1. Icons are **small** — `12-16px` (size-3 to size-4) for inline use, `16-20px` for standalone buttons.
2. Icons are **muted** by default (`--muted-foreground`), brightening to `--foreground` on hover/active.
3. Icons are **never colored** except for status (red error, amber warning, teal active).
4. Icon-only buttons must have a `title` attribute or tooltip for accessibility.
5. Use stroked (outline) icon variants, not filled. Filled icons are too heavy for this aesthetic.

---

## 7. Animation & Motion

Motion is fast, functional, and invisible. Nothing bounces, springs, or draws attention to itself.

| Context | Duration | Easing |
|---------|----------|--------|
| Hover state (color, background) | `120ms` | `ease` |
| Panel collapse/expand | `150ms` | `ease` |
| Content fade-in | `180ms` | `ease` |
| Collapsible open/close | `200ms` | `ease` |

### Rules

1. **No entrance animations** on messages or content. Text appears instantly.
2. **No loading skeletons.** Use subtle opacity pulsing if a loading state is absolutely necessary.
3. **No decorative transitions.** Transitions exist only to smooth state changes that would otherwise feel jarring.
4. **Running/active state**: The only repeating animation is a subtle spin on the tool call icon when an operation is in progress. It should be barely noticeable — not a flashy spinner.

---

## 8. Information Hierarchy

### What Gets Emphasis

| Level | Treatment | Examples |
|-------|-----------|---------|
| **User intent** | Amber-tinted background | User messages |
| **Active element** | Amber left border + muted bg | Active thread, current reasoning |
| **Machine output** | Plain text, no background | Assistant responses |
| **Technical metadata** | Monospace, `--muted-foreground` | File paths, branches, durations, tokens |
| **Tool activity** | Compact row, muted icon | Read, Write, Execute operations |
| **System status** | Small teal dot or mono text | Connected, running, session active |
| **Errors** | Red text/icon, no background | Failed operations |

### What Gets Suppressed

- **Timestamps** on individual messages — show only on hover or in metadata.
- **Model names** — show only in settings or on-demand.
- **Session IDs** — abbreviated, shown only when relevant.
- **Verbose tool output** — collapsed by default, one click to expand.

---

## 9. Scrollbar Styling

Scrollbars must be thin and unobtrusive:

```css
scrollbar-width: thin;
scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
```

No custom scrollbar on overlay panels — use native thin scrollbar everywhere.

---

## 10. Responsive Behavior

| Breakpoint | Behavior |
|------------|----------|
| `> 1024px` | Full 3-column layout |
| `< 1024px` | Sidebars hidden, single column |

Sidebars are toggled via ghost buttons in a bottom toolbar. The toolbar shows only when sidebars are collapsed.

---

## 11. Anti-Patterns (Never Do This)

1. **No card-heavy layouts.** Don't wrap content in bordered, padded cards with shadows. Content floats on the void.
2. **No colored section backgrounds.** No blue headers, green success banners, or gradient hero sections.
3. **No large text.** Nothing above `1rem` in the conversation UI. The largest element is a markdown h1 at `1rem`.
4. **No rounded avatars or user icons.** This is a code tool, not a social app.
5. **No loading bars or progress indicators.** Show running state with a subtle icon spin and elapsed time in mono.
6. **No notification badges with counts.** If something needs attention, surface it inline.
7. **No empty states with illustrations.** Empty states get a single line of muted text.
8. **No modals for simple actions.** Use inline expansion or dropdowns. Modals are reserved for destructive confirmations only.
9. **No toast notifications.** Status updates happen inline in the conversation flow.
10. **No hover cards or preview popovers.** If info is important, show it. If not, omit it.

---

## 12. Design Tokens (CSS Custom Properties Reference)

```css
:root {
  /* Background layers */
  --background:    #111114;
  --card:          #1a1a1f;
  --muted:         #27272d;
  --surface-code:  #141419;

  /* Foreground */
  --foreground:         #e4e4e7;
  --muted-foreground:   #8b8b96;

  /* Accent — semantic only */
  --primary:            #e8a849;   /* amber — user, active, CTA */
  --primary-foreground: #111114;
  --accent:             #4ec9b0;   /* teal — live, success */
  --accent-foreground:  #111114;
  --destructive:        #f04444;   /* red — error, danger */

  /* Borders */
  --border:  rgba(255, 255, 255, 0.08);
  --input:   rgba(255, 255, 255, 0.10);
  --ring:    #e8a849;

  /* Radius */
  --radius: 0.375rem;

  /* Fonts */
  --app-font:      "IBM Plex Sans", "Inter", system-ui, sans-serif;
  --app-font-mono: "IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace;
}
```

---

## 13. Conductor Alignment Checklist

How our current implementation maps to Conductor's design language:

| Conductor Pattern | Our Status | Notes |
|-------------------|-----------|-------|
| Deep dark background (~#1e1e22) | **Aligned** (`#111114`) | Ours is slightly darker, which is fine |
| Minimal chrome / borderless design | **Aligned** | Using 8% opacity borders |
| User messages with subtle warm tint | **Aligned** | 8% amber background |
| Assistant messages — plain, no background | **Aligned** | Transparent background |
| Compact single-line tool calls | **Needs refinement** | Currently using collapsible accordions — should be more compact by default |
| Inline monospace chips for file paths | **Aligned** | Composer chips use mono pills |
| Git branch display in header | **Aligned** | Workspace shows branch info |
| Tab interface for multiple tasks | **Partial** | We have thread list, not tabs yet |
| Timing/duration in monospace | **Aligned** | `.aui-running-elapsed` uses mono |
| No shadows anywhere | **Aligned** | No box-shadows in use |
| Flat, no gradients | **Aligned** | Pure flat design |
| Monospace for all technical metadata | **Aligned** | Paths, counts, branches all mono |

---

## 14. Visual Identity Summary

Pluribus looks like what happens when a senior engineer designs their ideal terminal, then adds just enough UI to make it accessible to a team. It is:

- **Dark** — not "dark mode", just dark. There is no light mode.
- **Flat** — no shadows, no gradients, no depth illusions.
- **Dense** — information-rich, tightly spaced, small type.
- **Warm-accented** — one amber accent against cold neutrals.
- **Monospace-forward** — technical metadata in mono, human text in sans.
- **Quiet** — nothing blinks, bounces, or demands attention. The content speaks.

The interface should feel like a well-tuned `tmux` session that happens to have a GUI.
