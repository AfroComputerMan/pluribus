# Repository Guidelines

## Project Structure & Module Organization
Frontend code lives in `src/` (React 19 + TypeScript + Vite). Keep app shell and composition in `src/App.tsx`, shared logic in `src/lib/`, and UI building blocks in `src/components/`:
- `src/components/ui/`: shadcn/Radix primitives
- `src/components/assistant-ui/`: assistant-ui thread/message composition
- `src/components/*.tsx`: feature-level components (for example `ThreadWorkspace.tsx`)

Desktop/runtime code lives in `src-tauri/`:
- `src-tauri/src/lib.rs`: Tauri app setup and command wiring
- `src-tauri/capabilities/default.json`: shell permission policy

Static assets are in `public/` and `src/assets/`.

## Build, Test, and Development Commands
Use Bun as the package manager.
- `bun install`: install JS dependencies
- `bun run dev`: frontend-only Vite dev server
- `cargo tauri dev` (or `bun run tauri dev`): run desktop app with Vite on port `1420`
- `bun run build`: TypeScript check + production frontend bundle
- `cargo tauri build`: desktop production build

## Coding Style & Naming Conventions
- TypeScript is strict (`strict`, `noUnusedLocals`, `noUnusedParameters`); keep code type-safe and warning-free.
- Use 2-space indentation in TS/TSX; follow `rustfmt` defaults for Rust.
- File names are kebab-case (for example `claude-adapter.ts`); React component names are PascalCase.
- Prefer `@/*` imports (alias to `src/*`) over deep relative paths.
- Reuse assistant-ui, shadcn, and Radix primitives before creating custom components.

## Testing Guidelines
No automated frontend test framework is currently configured. For now:
- run `bun run build` before opening a PR to catch type and bundling regressions
- validate key chat flows manually in `cargo tauri dev`
- for Rust changes, run `cargo test` in `src-tauri/` when tests are present

## Commit & Pull Request Guidelines
Recent history favors Conventional Commit-style prefixes: `feat:`, `refactor:`, `docs:`. Keep subjects imperative and concise (for example, `refactor: simplify runtime initialization`).

PRs should include:
- what changed and why
- linked issue/task (if available)
- local verification steps executed
- screenshots or recordings for UI/UX changes

## Security & Configuration Notes
When changing subprocess behavior, review `src-tauri/capabilities/default.json` and keep shell permissions as narrow as possible.
