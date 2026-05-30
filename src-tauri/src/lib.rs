use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use tokio::sync::Mutex;

mod codex;
pub mod pi;
use codex::commands::{
    codex_approve_tool, codex_get_auth_status, codex_get_pid, codex_interrupt_turn,
    codex_send_turn, codex_start_thread,
};
use codex::service::CodexService;
use pi::commands::{
    clone_dir_exists, dispose_clone, list_clone_dirs, pi_abort, pi_get_state, pi_prompt,
    pi_start_session, pi_stop, PiState,
};
use pi::service::PiService;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Kill a process by PID. Returns true if the signal was sent successfully.
/// Used by the frontend AgentProcessManager for orphan cleanup without needing
/// a shell permission entry.
#[tauri::command]
fn kill_pid(pid: u32) -> bool {
    use std::process::Command;
    // Send SIGTERM on unix
    #[cfg(unix)]
    {
        Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
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
        Migration {
            version: 9,
            description: "agent_state",
            sql: include_str!("../migrations/009_agent_state.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "agents_table_pi_restart_survival",
            sql: include_str!("../migrations/010_agents.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "clones_table_per_agent",
            sql: include_str!("../migrations/011_clones.sql"),
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
            app.manage(Mutex::new(
                std::collections::HashMap::<String, PiService>::new(),
            ));
            // Orphan reconcile (#18): force-remove any containers labeled
            // `pluribus.managed=true` left over from a prior run that skipped
            // teardown (TS `kill_pid` can't stop containers). Best-effort, async.
            tauri::async_runtime::spawn(async {
                pi::container::reap_managed_containers().await;
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Window close (#18): teardown EVERY live pi session so no container
            // is orphaned. Drains the map under the lock, then stops+removes
            // outside it (#25 — no lock across bollard awaits).
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<PiState>() {
                    let state: &PiState = state.inner();
                    tauri::async_runtime::block_on(async move {
                        let drained: Vec<PiService> = {
                            let mut guard = state.lock().await;
                            guard.drain().map(|(_, svc)| svc).collect()
                        };
                        for svc in &drained {
                            svc.teardown().await;
                        }
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            kill_pid,
            codex_start_thread,
            codex_send_turn,
            codex_interrupt_turn,
            codex_approve_tool,
            codex_get_auth_status,
            codex_get_pid,
            pi_start_session,
            pi_prompt,
            pi_abort,
            pi_stop,
            pi_get_state,
            dispose_clone,
            clone_dir_exists,
            list_clone_dirs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
