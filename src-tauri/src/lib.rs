// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_schema",
            sql: include_str!("../migrations/001_initial_schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_thread_dev_panel_state",
            sql: include_str!("../migrations/002_thread_dev_panel_state.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "ensure_mcp_invocations",
            sql: include_str!("../migrations/003_ensure_mcp_invocations.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "workspaces_and_thread_branch",
            sql: include_str!("../migrations/004_workspaces_and_thread_branch.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pluribus.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
