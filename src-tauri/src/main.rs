// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use pluribus_desktop_lib::*;
use tauri::Manager;

fn main() {
    let state = AppState::new();

    // Initialize SQLite database
    // Store in the app's data directory (resolved at runtime)
    // For dev, use a local file; the path will be overridden by setup hook
    let app_state = state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .manage(state)
        .setup(move |app| {
            // Initialize SQLite in the app's data directory
            let app_dir = app.path().app_data_dir()
                .expect("Failed to resolve app data directory");
            std::fs::create_dir_all(&app_dir)
                .expect("Failed to create app data directory");

            let db_path = app_dir.join("pluribus.db");
            let db_path_str = db_path.to_string_lossy().to_string();

            app_state.init_db(&db_path_str)
                .expect("Failed to initialize database");

            eprintln!("[Pluribus] Database initialized at: {}", db_path_str);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Chat commands
            commands::check_claude_cli,
            commands::send_message,
            commands::abort_session,
            commands::get_session_status,
            commands::get_session,
            commands::list_sessions,
            commands::create_session,
            commands::delete_session,
            commands::update_claude_session_id,
            #[cfg(unix)]
            commands::pause_session,
            #[cfg(unix)]
            commands::resume_session,
            // Worktree commands
            commands::create_worktree,
            commands::remove_worktree,
            commands::list_worktrees,
            commands::prune_worktrees,
            commands::is_git_repo,
            commands::get_default_branch,
            // DB proxy commands
            commands::execute_sql,
            commands::select_sql,
            // Project commands
            commands::open_project,
            commands::list_projects,
            commands::get_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
