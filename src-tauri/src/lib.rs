pub mod commands;
pub mod error;
pub mod process;
pub mod state;
pub mod worktree;

pub use error::AppError;
pub use state::AppState;

use tauri::Manager;

pub fn run() {
    let state = AppState::new();

    // Initialize SQLite database in setup once app paths are available.
    let app_state = state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .manage(state)
        .setup(move |app| {
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
            commands::chat::check_claude_cli,
            commands::chat::send_message,
            commands::chat::abort_session,
            commands::chat::get_session_status,
            commands::chat::get_session,
            commands::chat::list_sessions,
            commands::chat::create_session,
            commands::chat::delete_session,
            commands::chat::update_claude_session_id,
            #[cfg(unix)]
            commands::chat::pause_session,
            #[cfg(unix)]
            commands::chat::resume_session,
            // Worktree commands
            commands::worktree::create_worktree,
            commands::worktree::remove_worktree,
            commands::worktree::list_worktrees,
            commands::worktree::prune_worktrees,
            commands::worktree::is_git_repo,
            commands::worktree::get_default_branch,
            // DB proxy commands
            commands::db::execute_sql,
            commands::db::select_sql,
            // Project commands
            commands::project::open_project,
            commands::project::list_projects,
            commands::project::get_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
