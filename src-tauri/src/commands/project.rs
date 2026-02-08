/// Project management commands.
///
/// Projects represent git repositories managed by Pluribus Desktop.
/// Project metadata is stored in SQLite while validation happens via git.

use crate::error::AppError;
use crate::state::{AppState, utc_datetime_now};
use crate::worktree::manager::WorktreeManager;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub default_model: String,
    pub default_autonomy: String,
    pub created_at: String,
}

/// Open a project by path. Validates it's a git repo and stores in SQLite.
#[tauri::command]
pub async fn open_project(
    state: State<'_, AppState>,
    path: String,
) -> Result<Project, AppError> {
    // Validate path is a git repository
    if !WorktreeManager::is_git_repo(&path).await {
        return Err(AppError::InvalidInput(format!(
            "Path is not a git repository: {}", path
        )));
    }

    // Extract project name from path
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let id = uuid::Uuid::new_v4().to_string();
    let now = utc_datetime_now();

    // Insert into SQLite
    let db = state.db.lock()
        .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
    let db = db.as_ref()
        .ok_or_else(|| AppError::Database("Database not initialized".to_string()))?;

    // Check if project with this path already exists
    let existing: Option<String> = db.query_row(
        "SELECT id FROM projects WHERE path = ?1",
        rusqlite::params![&path],
        |row| row.get(0),
    ).ok();

    if let Some(existing_id) = existing {
        // Return existing project
        let project = db.query_row(
            "SELECT id, name, path, default_model, default_autonomy, created_at FROM projects WHERE id = ?1",
            rusqlite::params![&existing_id],
            |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    default_model: row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "sonnet".to_string()),
                    default_autonomy: row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "supervised".to_string()),
                    created_at: row.get(5)?,
                })
            },
        ).map_err(|e| AppError::Database(format!("Failed to query project: {}", e)))?;

        return Ok(project);
    }

    db.execute(
        "INSERT INTO projects (id, name, path, default_model, default_autonomy, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![&id, &name, &path, "sonnet", "supervised", &now],
    ).map_err(|e| AppError::Database(format!("Failed to insert project: {}", e)))?;

    Ok(Project {
        id,
        name,
        path,
        default_model: "sonnet".to_string(),
        default_autonomy: "supervised".to_string(),
        created_at: now,
    })
}

/// List all projects from SQLite.
#[tauri::command]
pub async fn list_projects(
    state: State<'_, AppState>,
) -> Result<Vec<Project>, AppError> {
    let db = state.db.lock()
        .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
    let db = db.as_ref()
        .ok_or_else(|| AppError::Database("Database not initialized".to_string()))?;

    let mut stmt = db.prepare(
        "SELECT id, name, path, default_model, default_autonomy, created_at FROM projects ORDER BY created_at DESC"
    ).map_err(|e| AppError::Database(format!("Failed to prepare query: {}", e)))?;

    let projects = stmt.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            default_model: row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "sonnet".to_string()),
            default_autonomy: row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "supervised".to_string()),
            created_at: row.get(5)?,
        })
    }).map_err(|e| AppError::Database(format!("Failed to query projects: {}", e)))?;

    let mut result = Vec::new();
    for project in projects {
        result.push(project.map_err(|e| AppError::Database(format!("Row error: {}", e)))?);
    }

    Ok(result)
}

/// Get a single project by ID.
#[tauri::command]
pub async fn get_project(
    state: State<'_, AppState>,
    id: String,
) -> Result<Project, AppError> {
    let db = state.db.lock()
        .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
    let db = db.as_ref()
        .ok_or_else(|| AppError::Database("Database not initialized".to_string()))?;

    db.query_row(
        "SELECT id, name, path, default_model, default_autonomy, created_at FROM projects WHERE id = ?1",
        rusqlite::params![&id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                default_model: row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "sonnet".to_string()),
                default_autonomy: row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "supervised".to_string()),
                created_at: row.get(5)?,
            })
        },
    ).map_err(|e| AppError::Database(format!("Project not found: {}", e)))
}

