# Tauri Backend

## Rust: src-tauri/src/lib.rs (48 lines)
- Registers 4 SQL migrations, initializes plugins: dialog, shell, sql (SQLite)
- src-tauri/src/main.rs (6 lines) — entry point stub

## Config: tauri.conf.json
- App: com.noahr.pluribus, 800x600 window
- Dev: Vite on localhost:1420, build via bun
- SQL preload: sqlite:pluribus.db

## Capabilities: default.json
- shell:allow-spawn/execute — `claude` command
- shell:allow-kill — process termination
- dialog:default, core:default, SQL execute

## Migrations (src-tauri/migrations/)
1. 001 — threads, messages
2. 002 — dev panel state
3. 003 — mcp_invocations
4. 004 — workspaces, thread branching

## Rust Deps: tauri 2, serde, serde_json, tauri-plugin-shell/sql/dialog
## Release: opt-level=3, thin LTO, stripped
