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

## Design Language
For any UI/UX work, consult `docs/design-language.md` and follow it as the source of truth for visual and interaction decisions.


## Skills
A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path so you can open the source for full instructions when using a specific skill.
### Available skills
- coding-guidelines: Use when asking about Rust code style or best practices. Keywords: naming, formatting, comment, clippy, rustfmt, lint, code style, best practice, P.NAM, G.FMT, code review, naming convention, variable naming, function naming, type naming, 命名规范, 代码风格, 格式化, 最佳实践, 代码审查, 怎么命名 (file: /home/user/.agents/skills/coding-guidelines/SKILL.md)
- configuring-tauri-permissions: Guides the user through configuring Tauri permissions, including the security permission system, allow and deny lists, plugin permissions, permission identifiers, scopes, and capability integration. (file: /home/user/.agents/skills/configuring-tauri-permissions/SKILL.md)
- find-skills: Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill. (file: /home/user/.agents/skills/find-skills/SKILL.md)
- frontend-design: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics. (file: /home/user/.agents/skills/frontend-design/SKILL.md)
- integrating-tauri-js-frontends: Guides Claude through configuring JavaScript frontend frameworks for Tauri v2 desktop applications, including Next.js, Nuxt, Qwik, SvelteKit, and Vite with proper SSG setup, tauri.conf.json settings, and framework-specific configurations. (file: /home/user/.agents/skills/integrating-tauri-js-frontends/SKILL.md)
- react-best-practices: Provides React patterns for hooks, effects, refs, and component design. Covers escape hatches, anti-patterns, and correct effect usage. Must use when reading or writing React components (.tsx, .jsx files with React imports). (file: /home/user/.agents/skills/react-best-practices/SKILL.md)
- remotion-best-practices: Best practices for Remotion - Video creation in React (file: /home/user/.agents/skills/remotion-best-practices/SKILL.md)
- rust-async-patterns: Master Rust async programming with Tokio, async traits, error handling, and concurrent patterns. Use when building async Rust applications, implementing concurrent systems, or debugging async code. (file: /home/user/.agents/skills/rust-async-patterns/SKILL.md)
- rust-best-practices: Guide for writing idiomatic Rust code based on Apollo GraphQL's best practices handbook. Use this skill when: (1) writing new Rust code or functions, (2) reviewing or refactoring existing Rust code, (3) deciding between borrowing vs cloning or ownership patterns, (4) implementing error handling with Result types, (5) optimizing Rust code for performance, (6) writing tests or documentation for Rust projects. (file: /home/user/.agents/skills/rust-best-practices/SKILL.md)
- rust-engineer: Use when building Rust applications requiring memory safety, systems programming, or zero-cost abstractions. Invoke for ownership patterns, lifetimes, traits, async/await with tokio. (file: /home/user/.agents/skills/rust-engineer/SKILL.md)
- tauri-v2: Tauri v2 cross-platform app development with Rust backend. Use when configuring tauri.conf.json, implementing Rust commands (#[tauri::command]), setting up IPC patterns (invoke, emit, channels), configuring permissions/capabilities, troubleshooting build issues, or deploying desktop/mobile apps. Triggers on Tauri, src-tauri, invoke, emit, capabilities.json. (file: /home/user/.agents/skills/tauri-v2/SKILL.md)
- vercel-react-best-practices: React and Next.js performance optimization guidelines from Vercel Engineering. This skill should be used when writing, reviewing, or refactoring React/Next.js code to ensure optimal performance patterns. Triggers on tasks involving React components, Next.js pages, data fetching, bundle optimization, or performance improvements. (file: /home/user/.agents/skills/vercel-react-best-practices/SKILL.md)
- skill-creator: Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Codex's capabilities with specialized knowledge, workflows, or tool integrations. (file: /home/user/.codex/skills/.system/skill-creator/SKILL.md)
- skill-installer: Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo (including private repos). (file: /home/user/.codex/skills/.system/skill-installer/SKILL.md)
### How to use skills
- Discovery: The list above is the skills available in this session (name + description + file path). Skill bodies live on disk at the listed paths.
- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing/blocked: If a named skill isn't in the list or the path can't be read, say so briefly and continue with the best fallback.
- How to use a skill (progressive disclosure):
  1) After deciding to use a skill, open its `SKILL.md`. Read only enough to follow the workflow.
  2) When `SKILL.md` references relative paths (e.g., `scripts/foo.py`), resolve them relative to the skill directory listed above first, and only consider other paths if needed.
  3) If `SKILL.md` points to extra folders such as `references/`, load only the specific files needed for the request; don't bulk-load everything.
  4) If `scripts/` exist, prefer running or patching them instead of retyping large code blocks.
  5) If `assets/` or templates exist, reuse them instead of recreating from scratch.
- Coordination and sequencing:
  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.
  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.
- Context hygiene:
  - Keep context small: summarize long sections instead of pasting them; only load extra files when needed.
  - Avoid deep reference-chasing: prefer opening only files directly linked from `SKILL.md` unless you're blocked.
  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.
- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.
