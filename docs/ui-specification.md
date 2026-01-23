# Agent Organization System - UI Specification

**Source**: `code-agent-hub.pen`
**Created**: 2026-01-24
**Status**: Design Complete

---

## 1. Design System

### 1.1 Color Tokens

| Token | Usage |
|-------|-------|
| `$--bg-page` | Page background |
| `$--bg-card` | Card/panel backgrounds |
| `$--bg-surface` | Input backgrounds, secondary surfaces |
| `$--white-primary` | Primary text |
| `$--gray-600` | Secondary text, icons |
| `$--gray-500` | Tertiary text |
| `$--orange-primary` | Primary accent, CTAs, active states |
| `$--teal-success` | Success states, active indicators |
| `$--yellow-warning` | Warning states |
| `$--blue-accent` | Info accent |
| `$--purple-accent` | Alternative accent |
| `$--border` | Border color |

### 1.2 Typography

| Style | Font | Size | Weight | Usage |
|-------|------|------|--------|-------|
| Logo | Oswald | 24px | 600 | Brand logo "PLURIBUS" |
| Page Title | Oswald | 48px | 700 | Main page headings |
| Section Title | Oswald | 32px | 700 | Section headers |
| Card Title | Oswald | 20px | 600 | Card/modal headers |
| Metric Value | Oswald | 40px | 700 | Large metric numbers |
| Body | JetBrains Mono | 12-13px | normal | Body text, labels |
| Caption | JetBrains Mono | 10-11px | normal | Captions, meta info |
| Code Label | JetBrains Mono | 10px | normal | `// LABELS` style |

### 1.3 Layout Constants

| Property | Value |
|----------|-------|
| Sidebar Width | 240px |
| Content Padding | 32px vertical, 40px horizontal |
| Card Padding | 16-20px |
| Gap (sections) | 24-32px |
| Gap (items) | 8-16px |
| Border Radius | Default (cards) |
| Screen Width | 1440px |
| Screen Height | 900-1000px |

---

## 2. Reusable Components

### 2.1 Navigation Components

#### Component/Logo Section (`jiXAk`)
```
┌─────────────────────┐
│ // SYSTEM           │  ← Orange, 10px
│ PLURIBUS            │  ← White, Oswald 24px
│ v1.0.0-beta         │  ← Gray, 10px
└─────────────────────┘
```
**Props**: systemLabel, logoText, versionTag

#### Component/Nav Item/Active (`LYiZs`)
```
┌─────────────────────────────┐
│ ● 🤖 agents()               │  ← Orange background, white text
└─────────────────────────────┘
```
**Props**: icon (lucide), label
**Styling**: Orange fill, white text, 40px height

#### Component/Nav Item/Inactive (`ajXmZ`)
```
┌─────────────────────────────┐
│   🔧 tools()                │  ← Transparent, gray text
└─────────────────────────────┘
```
**Props**: icon (lucide), label
**Styling**: Transparent fill, gray-600 text, 40px height

#### Component/Sidebar (`ATZyj`)
Complete sidebar with logo, navigation items, and account section.
**Contains**: Logo Section, Nav Items (6), Account Section
**Nav Items**: agents, repos, skills, tools, graph, config

#### Component/Account Section (`6y06C`)
```
┌─────────────────────────────┐
│ ─────────────────────────── │  ← Divider
│ [NH] username               │
│      role                   │
└─────────────────────────────┘
```
**Props**: initials, username, role

---

### 2.2 Button Components

#### Component/Button/Primary (`qh749`)
```
┌─────────────────────┐
│ ➕ action()         │  ← Orange background
└─────────────────────┘
```
**Props**: icon (lucide), label
**Styling**: Orange fill, white text, 40px height, 20px horizontal padding

#### Component/Button/Secondary (`T6N8Q`)
```
┌─────────────────────┐
│ ⚙️ action()         │  ← Surface background
└─────────────────────┘
```
**Props**: icon (lucide), label
**Styling**: Surface fill, white text, gray icon, 40px height

---

### 2.3 Data Display Components

#### Component/Metric Card/Primary (`CxkDx`)
```
┌─────────────────────────────┐
│ METRIC_LABEL    ● LIVE      │  ← Header with badge
│ 00                          │  ← Large value (Oswald 40px)
│ +0 this_period              │  ← Change indicator
└─────────────────────────────┘
```
**Props**: label, value, change, period, badgeText
**Styling**: Orange background, white text

#### Component/Metric Card/Secondary (`TT3lN`)
```
┌─────────────────────────────┐
│ METRIC_LABEL    ● ACTIVE    │
│ 00                          │
│ +0% vs last_period          │
└─────────────────────────────┘
```
**Props**: label, value, change, period, badgeText, badgeColor
**Styling**: Card background with border, colored badge

#### Component/Card (`JoPBw`)
Generic card container with header and content slot.
```
┌─────────────────────────────┐
│ CARD_TITLE      view_all()  │  ← Header
│ ┌─────────────────────────┐ │
│ │ [slot: content]         │ │  ← Content slot
│ └─────────────────────────┘ │
└─────────────────────────────┘
```
**Props**: title, action
**Slot**: content (vertical layout)

#### Component/Section Header (`jNSMd`)
```
Section Title
Section subtitle description
```
**Props**: title (Oswald 32px), subtitle

#### Component/Module Card (`P1qmz`)
```
┌─────────────────────────────────┐
│ [icon] module_name          ●   │  ← Header with status
│ Module description text...      │
│ function  v1.0.0    3 agents   │  ← Meta row
└─────────────────────────────────┘
```
**Props**: iconBg, name, description, type, version, agentCount, statusColor

---

### 2.4 Form Components

#### Component/Search Input (`q4F62`)
```
┌─────────────────────────────┐
│ 🔍 > search...              │
└─────────────────────────────┘
```
**Props**: placeholder
**Styling**: Card background with border, 40px height

#### Component/Input Field (`5hJhH`)
```
field_label
┌─────────────────────────────┐
│ Enter value...              │
└─────────────────────────────┘
```
**Props**: label, placeholder

#### Component/Textarea Field (`gO9Xc`)
```
field_label
┌─────────────────────────────┐
│ Enter description...        │
│                             │
│                             │
└─────────────────────────────┘
```
**Props**: label, placeholder
**Height**: 100px

#### Component/Type Selector (`emieb`)
```
MODULE_TYPE
┌──────────┐ ┌──────────┐ ┌──────────┐
│ 💻       │ │ ▶️       │ │ 🔌       │
│ function │ │ program  │ │ connector│
└──────────┘ └──────────┘ └──────────┘
  (active)
```
**Props**: label, options (icon, label, selected)

---

### 2.5 Modal Components

#### Component/Modal Overlay (`Hvecc`)
```
┌─────────────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ░░░┌────────────────────────────┐░░░░░ │
│ ░░░│ Modal Title            ✕  │░░░░░ │
│ ░░░├────────────────────────────┤░░░░░ │
│ ░░░│ [slot: body]              │░░░░░ │
│ ░░░├────────────────────────────┤░░░░░ │
│ ░░░│         [cancel] [confirm]│░░░░░ │
│ ░░░└────────────────────────────┘░░░░░ │
└─────────────────────────────────────────┘
```
**Props**: title
**Slot**: body
**Actions**: cancel (secondary), confirm (primary)
**Styling**: Semi-transparent black overlay (#000000CC)

---

## 3. Views (Screens)

### 3.1 Dashboard (`F0PQK`)
**Route**: `/` or `/dashboard`
**Purpose**: Main command center overview

**Layout**:
```
┌──────────┬─────────────────────────────────────────────────┐
│          │ breadcrumbs                          [search]   │
│          ├─────────────────────────────────────────────────┤
│          │ // PLURIBUS                                     │
│ SIDEBAR  │ COMMAND CENTER           [config] [new_agent]  │
│          │ Multi-agent framework...                        │
│          ├─────────────────────────────────────────────────┤
│          │ [Metric1] [Metric2] [Metric3] [Metric4]        │
│          ├───────────────────────────┬─────────────────────┤
│          │ Active Agents Section     │ Command Section     │
│          │ - Agent cards list        │ - Command input     │
│          │                           ├─────────────────────┤
│          │                           │ Notifications       │
│          │                           │ - Notif list        │
└──────────┴───────────────────────────┴─────────────────────┘
```

**Metrics**:
- ACTIVE_AGENTS (primary, with LIVE badge)
- TASKS_RUNNING (secondary)
- REPOS_CONNECTED (secondary)
- MODULES_INSTALLED (secondary)

**Actions**: `config()`, `new_agent()`

---

### 3.2 Agent Detail View (`8ORGg`)
**Route**: `/agents/:id`
**Purpose**: View and control individual agent

**Layout**:
```
┌──────────┬─────────────────────────────────────────────────┐
│          │ breadcrumbs                        [← back]     │
│          ├─────────────────────────────────────────────────┤
│          │ // AGENT_DETAIL                                 │
│ SIDEBAR  │ CODE_REVIEWER.AGENT      [pause] [restart]     │
│          │ status badges...                                │
│          ├───────────────────────────┬─────────────────────┤
│          │ VM Preview                │ Modules Section     │
│          │ ┌───────────────────────┐ │ - Module cards      │
│          │ │ Terminal-style view   │ ├─────────────────────┤
│          │ │ of agent activity     │ │ Repos Section       │
│          │ └───────────────────────┘ │ - Connected repos   │
└──────────┴───────────────────────────┴─────────────────────┘
```

**Actions**: `back()`, `pause()`, `restart()`

---

### 3.3 Agent Graph Visualization (`bMJaA`)
**Route**: `/graph`
**Purpose**: Real-time visualization of multi-agent collaboration

**Layout**:
```
┌──────────┬─────────────────────────────────────────────────┐
│          │ breadcrumbs                    [2D] [3D]        │
│          ├─────────────────────────────────────────────────┤
│          │ // AGENT_ORCHESTRATION                          │
│ SIDEBAR  │ GRAPH STATE              [export] [run_all]    │
│          │ Real-time visualization...                      │
│          ├───────────────────────────┬─────────────────────┤
│          │ Graph Canvas              │ Selected Agent      │
│          │ ┌───────────────────────┐ │ - Agent info        │
│          │ │    [Orchestrator]     │ ├─────────────────────┤
│          │ │    /    |    \        │ │ Tools Section       │
│          │ │ [CR] [Test] [Doc]     │ │ - Available tools   │
│          │ │   \    /              │ ├─────────────────────┤
│          │ │  [Refactor][Deploy]   │ │ Output Logs         │
│          │ └───────────────────────┘ │ - Live output       │
└──────────┴───────────────────────────┴─────────────────────┘
```

**Features**:
- Interactive node graph with connections
- Node status colors (teal=active, yellow=warning, gray=idle)
- 2D/3D view toggle
- Real-time output streaming

**Actions**: `export()`, `run_all()`

---

### 3.4 Agent Configuration (`kTM61`)
**Route**: `/agents/new` or `/agents/:id/edit`
**Purpose**: Create or edit agent configuration

**Layout**:
```
┌──────────┬─────────────────────────────────────────────────┐
│          │ breadcrumbs                                     │
│          ├─────────────────────────────────────────────────┤
│          │ // AGENT_CONFIGURATION                          │
│ SIDEBAR  │ CREATE AGENT             [cancel] [save_agent] │
│          │ Define a new agent...                           │
│          ├───────────────────────────┬─────────────────────┤
│          │ Basic Info Card           │ Agent Preview       │
│          │ - Name, description       │ - Live preview      │
│          │ - System prompt           ├─────────────────────┤
│          ├───────────────────────────┤ Behavior Settings   │
│          │ Tools Config Card         │ - Toggles/options   │
│          │ - Available tools grid    │                     │
└──────────┴───────────────────────────┴─────────────────────┘
```

**Form Fields**: Name, Description, System Prompt, Tool selection, Behavior toggles
**Actions**: `cancel()`, `save_agent()`

---

### 3.5 Skills & MCP Tools Hub (`H0g9i`)
**Route**: `/skills` or `/tools`
**Purpose**: Manage skills and MCP tool integrations

**Layout**:
```
┌──────────┬─────────────────────────────────────────────────┐
│          │ breadcrumbs                          [search]   │
│          ├─────────────────────────────────────────────────┤
│          │ // SKILLS_HUB                                   │
│ SIDEBAR  │ SKILLS & MCP TOOLS       [browse] [add_skill]  │
│          │ Extend agent capabilities...                    │
│          ├─────────────────────────────────────────────────┤
│          │ [Skills] [MCP Servers] [Tools] [Invocations]   │
│          ├───────────────────────────┬─────────────────────┤
│          │ Skills List               │ MCP Servers List    │
│          │ - Skill items (4)         │ - Server cards (4)  │
│          │   manage() →              │   add_server() →    │
└──────────┴───────────────────────────┴─────────────────────┘
```

**Metrics**:
- SKILLS_INSTALLED (primary)
- MCP_SERVERS (secondary)
- TOOLS_AVAILABLE (secondary)
- INVOCATIONS_24H (secondary)

**Actions**: `browse()`, `add_skill()`, `manage()`, `add_server()`

---

### 3.6 Repos View (`ihgc4`)
**Route**: `/repos`
**Purpose**: Manage connected repositories

**Layout**: Standard list view with search and repo cards

---

### 3.7 Tools View (`PdNE9`)
**Route**: `/tools`
**Purpose**: Browse and manage available tools

**Layout**: Metrics + tools list with filtering

---

### 3.8 Modules Hub (`fxd5n`)
**Route**: `/modules`
**Purpose**: Browse and manage installed modules

**Layout**: Similar to dashboard with metrics and module cards

---

### 3.9 Module Detail View (`np8o3`)
**Route**: `/modules/:id`
**Purpose**: View module details and configuration

---

### 3.10 Create Module Modal (`Y5WFR`)
**Trigger**: From Modules Hub
**Purpose**: Create new module

**Form Fields**:
- Module name (input)
- Description (textarea)
- Module type (type selector: function/program/connector)

---

## 4. Onboarding Flow

### 4.1 Welcome (`2B8Hd`)
**Route**: `/onboarding` or `/onboarding/welcome`
**Purpose**: Introduction and feature overview

**Layout**: Centered hero content
- Hero section with title/description
- Features grid
- CTA section
- Footer info

---

### 4.2 Provider Onboarding (`y2wg9`)
**Route**: `/onboarding/providers`
**Purpose**: Connect AI model providers

**Layout**:
```
┌──────────┬─────────────────────────────────────────────────┐
│          │ ████████████████████░░░░░░░  Progress bar       │
│          ├─────────────────────────────────────────────────┤
│          │ // ONBOARDING                                   │
│ SIDEBAR  │ CONFIGURE PROVIDERS              Step 2 of 4   │
│          │ Connect your AI model providers...              │
│          ├─────────────────────────────────────────────────┤
│          │ // AVAILABLE_PROVIDERS                          │
│          │ ┌────────────────┐ ┌────────────────┐          │
│          │ │ Anthropic      │ │ OpenAI         │          │
│          │ │ OAuth config   │ │ OAuth config   │          │
│          │ │ [connected]    │ │ [connect]      │          │
│          │ └────────────────┘ └────────────────┘          │
│          ├─────────────────────────────────────────────────┤
│          │ // OTHER_PROVIDERS                              │
│          │ [Google] [Mistral] [Ollama] [Custom]           │
│          ├─────────────────────────────────────────────────┤
│          │ [← back]              [skip_for_now] [continue]│
└──────────┴─────────────────────────────────────────────────┘
```

**Providers**: Anthropic (primary), OpenAI, Google, Mistral, Ollama, Custom

---

### 4.3 MCP Tools Onboarding (`rFD3D`)
**Route**: `/onboarding/mcp`
**Purpose**: Configure MCP servers

**Layout**: Similar to providers, with MCP server cards

---

### 4.4 Review & Launch (`EmHiW`)
**Route**: `/onboarding/review`
**Purpose**: Review configuration and launch

**Sections**:
- Summary of configured providers
- Stats section
- Launch CTA

---

## 5. API Mapping

| View | Primary API Endpoints |
|------|----------------------|
| Dashboard | `GET /api/agents`, `GET /api/runs`, `GET /api/metrics` |
| Agent Detail | `GET /api/agents/:id`, `GET /api/runs?agentId=:id`, `POST /api/agents/:id/pause` |
| Agent Graph | `GET /api/runs/:id`, `WS /ws/runs/:id`, `GET /api/workflows/:id` |
| Agent Config | `POST /api/agents`, `PUT /api/agents/:id`, `GET /api/mcp/tools` |
| Skills Hub | `GET /api/skills`, `GET /api/mcp/servers`, `GET /api/mcp/tools` |
| Provider Onboarding | `GET /api/integrations`, `POST /api/integrations/:type/auth` |
| MCP Onboarding | `GET /api/mcp/servers`, `POST /api/mcp/servers` |
| Repos View | `GET /api/repos` |
| Tools View | `GET /api/mcp/tools` |
| Modules Hub | `GET /api/modules` |

---

## 6. Component → React Mapping

| Pencil Component | React Component | Props |
|------------------|-----------------|-------|
| Component/Logo Section | `<Logo />` | - |
| Component/Nav Item/Active | `<NavItem active />` | icon, label, href |
| Component/Nav Item/Inactive | `<NavItem />` | icon, label, href |
| Component/Sidebar | `<Sidebar />` | activeItem |
| Component/Account Section | `<AccountSection />` | user |
| Component/Button/Primary | `<Button variant="primary" />` | icon, children, onClick |
| Component/Button/Secondary | `<Button variant="secondary" />` | icon, children, onClick |
| Component/Metric Card/Primary | `<MetricCard variant="primary" />` | label, value, change, badge |
| Component/Metric Card/Secondary | `<MetricCard />` | label, value, change, badge |
| Component/Card | `<Card />` | title, action, children |
| Component/Section Header | `<SectionHeader />` | title, subtitle |
| Component/Module Card | `<ModuleCard />` | module |
| Component/Search Input | `<SearchInput />` | placeholder, value, onChange |
| Component/Input Field | `<InputField />` | label, placeholder, value, onChange |
| Component/Textarea Field | `<TextareaField />` | label, placeholder, value, onChange |
| Component/Type Selector | `<TypeSelector />` | label, options, value, onChange |
| Component/Modal Overlay | `<Modal />` | title, children, onClose, onConfirm |
