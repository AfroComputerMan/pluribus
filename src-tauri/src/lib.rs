use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use tokio::sync::Mutex;

mod codex;
use codex::commands::{
    codex_approve_tool, codex_get_auth_status, codex_interrupt_turn, codex_send_turn,
    codex_start_thread,
};
use codex::service::CodexService;

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
        Migration {
            version: 5,
            description: "thread_model_effort",
            sql: include_str!("../migrations/005_thread_model_effort.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "config_overrides",
            sql: include_str!("../migrations/006_config_overrides.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "global_settings",
            sql: include_str!("../migrations/007_global_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "active_processes_tracking",
            sql: include_str!("../migrations/008_active_processes.sql"),
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
        .setup(|app| {
            app.manage(Mutex::new(Option::<CodexService>::None));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            codex_start_thread,
            codex_send_turn,
            codex_interrupt_turn,
            codex_approve_tool,
            codex_get_auth_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
