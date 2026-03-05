# Technology Stack

**Analysis Date:** 2026-03-05

## Languages

**Primary:**
- TypeScript ~5.8.3 - Frontend (React), sidecar (Bun), all application logic
- Rust 2021 edition - Tauri backend (`src-tauri/`)

**Secondary:**
- SQL - SQLite migrations (`src-tauri/migrations/`)
- CSS - Tailwind v4 utility classes (`src/App.css`)

## Runtime

**Environment:**
- Tauri 2 - Desktop application shell (Rust backend + webview frontend)
- Bun - JavaScript/TypeScript runtime for sidecar and package management
- Vite 7 dev server on port 1420 during development

**Package Manager:**
- bun (frontend + sidecar)
- Cargo (Rust backend)
- Lockfiles: `bun.lock` present, no `Cargo.lock` committed

## Frameworks

**Core:**
- React 19.1 - UI framework (`package.json`)
- Tauri 2 - Desktop app framework (`src-tauri/Cargo.toml`)
- assistant-ui 0.12.9 - Chat UI primitives (`@assistant-ui/react`, `@assistant-ui/react-markdown`)

**Build/Dev:**
- Vite 7 - Frontend bundler (`vite.config.ts`)
- `@vitejs/plugin-react` 4.6 - React Fast Refresh
- `@tailwindcss/vite` 4.1 - Tailwind CSS v4 Vite plugin
- tauri-build 2 - Rust build integration

**Testing:**
- None configured

## Key Dependencies

**Critical (Frontend):**
- `@assistant-ui/react` ^0.12.9 - Chat UI primitives (ThreadPrimitive, MessagePrimitive, ComposerPrimitive)
- `@assistant-ui/react-markdown` ^0.12.3 - Markdown rendering in chat messages
- `assistant-stream` ^0.3.2 - Streaming protocol support for assistant-ui
- `@tauri-apps/api` ^2 - Tauri IPC bridge (webview -> Rust)
- `@tauri-apps/plugin-shell` ~2 - Spawn CLI processes from webview
- `@tauri-apps/plugin-sql` ^2.3.2 - SQLite access from webview
- `react` ^19.1.0 / `react-dom` ^19.1.0 - UI framework

**Critical (Sidecar):**
- `@anthropic-ai/claude-agent-sdk` latest - Claude Agent SDK for agent-sdk engine mode (`sidecar/agent-sdk-bridge/package.json`)
- `zod` ^3.24.1 - Schema validation in sidecar

**Critical (Rust backend):**
- `tauri` 2 - Core application framework
- `tauri-plugin-shell` 2 - Shell command execution
- `tauri-plugin-sql` 2 (sqlite feature) - SQLite database
- `tauri-plugin-dialog` 2 - Native file/folder dialogs
- `tokio` 1 (full features) - Async runtime
- `serde` 1 / `serde_json` 1 - JSON serialization
- `uuid` 1 (v4) - UUID generation

**UI/Styling:**
- `tailwindcss` ^4.1.18 - Utility-first CSS (v4, not v3)
- `tailwind-merge` ^3.4.0 - Merge Tailwind classes
- `class-variance-authority` ^0.7.1 - Component variant management
- `clsx` ^2.1.1 - Conditional classNames
- `radix-ui` ^1.4.3 - Accessible UI primitives
- `shadcn` ^3.8.4 (devDep) - Component scaffolding CLI
- `lucide-react` ^0.563.0 - Icon library
- `tw-animate-css` ^1.4.0 (devDep) - Animation utilities

**Other:**
- `highlight.js` ^11.11.1 - Code syntax highlighting
- `remark-gfm` ^4.0.1 - GitHub Flavored Markdown
- `sonner` ^2.0.7 - Toast notifications
- `zustand` ^5.0.11 - State management (lightly used)

## Configuration

**TypeScript:**
- Strict mode with `noUnusedLocals` and `noUnusedParameters` enforced
- Target: ES2020, module: ESNext, JSX: react-jsx
- Path alias: `@/*` -> `src/*` (configured in `tsconfig.json` and `vite.config.ts`)
- Three tsconfig files: `tsconfig.json` (base), `tsconfig.app.json`, `tsconfig.node.json`

**Vite:**
- Config: `vite.config.ts`
- Dev server: port 1420 (strictPort)
- HMR: port 1421 when `TAURI_DEV_HOST` is set
- Plugins: `@vitejs/plugin-react`, `@tailwindcss/vite`

**shadcn/ui:**
- Config: `components.json`
- Style: new-york
- Base color: slate
- CSS variables: enabled
- Icon library: lucide
- Components path: `@/components/ui`
- Non-RSC mode

**Tauri:**
- Config: `src-tauri/tauri.conf.json`
- App identifier: `com.noahr.pluribus`
- CSP: restrictive (self, IPC, asset protocol, blob/data for images)
- SQLite preloaded: `sqlite:pluribus.db`
- External binary: `binaries/agent-sdk-bridge` (Bun-compiled sidecar)
- Shell permissions: `claude`, `sh`, `git`, `codex`, `agent-sdk-bridge` sidecar (`src-tauri/capabilities/default.json`)

**Build:**
- `bun run build` - Compiles sidecar + tsc + vite build
- `bun run build:sidecar` - `bun build --compile` sidecar with host triple suffix
- `cargo tauri dev` - Development mode (Vite + Tauri window)
- `cargo tauri build` - Production build

## Platform Requirements

**Development:**
- Bun runtime installed
- Rust toolchain (cargo, rustc)
- Tauri CLI (`@tauri-apps/cli`)
- Claude CLI installed and in PATH (required by both engine modes)
- Codex CLI installed and in PATH (optional, for codex engine)

**Production:**
- Desktop OS (Linux, macOS, Windows) - Tauri builds native binaries
- Claude CLI must be installed on the user's machine
- No cloud services required - fully local application

---

*Stack analysis: 2026-03-05*
