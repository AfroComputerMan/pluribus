# Pluribus Desktop - Rust Backend

This is the Tauri 2.0 Rust backend for Pluribus Desktop.

## Structure

```
src-tauri/
├── src/
│   ├── main.rs          # Tauri app entry point
│   ├── lib.rs           # Library exports
│   ├── state.rs         # AppState management
│   ├── error.rs         # Error types
│   ├── commands/        # Tauri command handlers
│   ├── process/         # Claude CLI process management
│   └── worktree/        # Project directory operations
├── Cargo.toml           # Rust dependencies
├── tauri.conf.json      # Tauri configuration
├── capabilities/        # Permission definitions
│   └── default.json
└── build.rs             # Build script
```

## Dependencies

- **tauri 2.0**: Core framework
- **tauri-plugin-shell**: Shell command execution (claude, git)
- **tauri-plugin-sql**: SQLite database access
- **tauri-plugin-fs**: Filesystem operations
- **tokio**: Async runtime
- **serde**: Serialization
- **thiserror**: Error handling

## Commands

Tauri commands are async Rust functions that can be invoked from the frontend via IPC.

Example:
```rust
#[tauri::command]
async fn my_command(state: State<'_, AppState>) -> Result<String, AppError> {
    Ok("Hello from Rust".to_string())
}
```

Register in `main.rs`:
```rust
.invoke_handler(tauri::generate_handler![my_command])
```

Invoke from frontend:
```typescript
import { invoke } from '@tauri-apps/api/core';
const result = await invoke<string>('my_command');
```

## State Management

AppState is managed by Tauri and accessible in all commands:
- **sessions**: Active chat sessions by ID
- **processes**: Active Claude CLI processes by session ID

## Plugins

### Shell Plugin
Allows spawning `claude` and `git` commands with stdio pipes.

Scope configured in `tauri.conf.json`:
```json
{
  "shell": {
    "scope": [
      { "name": "claude", "cmd": "claude", "args": true },
      { "name": "git", "cmd": "git", "args": true }
    ]
  }
}
```

### SQL Plugin
Provides SQLite access with preloaded database.

Frontend usage:
```typescript
import Database from '@tauri-apps/plugin-sql';
const db = await Database.load('sqlite:pluribus.db');
```

### FS Plugin
Allows reading project directories with scoped permissions.

Scope configured in `tauri.conf.json`:
```json
{
  "fs": {
    "scope": [
      { "path": "$APPDATA/**" },
      { "path": "$HOME/projects/**" }
    ]
  }
}
```

## Building

```bash
# Development (from project root)
bun run tauri dev

# Production build
bun run tauri build
```

## Testing

Rust tests can be added alongside modules:
```bash
cd src-tauri
cargo test
```
