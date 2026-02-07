/// Database proxy commands for Drizzle ORM sqlite-proxy pattern.
///
/// These commands allow the TypeScript frontend to execute SQL via Tauri IPC,
/// enabling Drizzle ORM to run type-safe queries while Rust handles actual
/// SQLite execution.

use crate::error::AppError;
use crate::state::AppState;
use tauri::State;

/// Execute a write SQL statement (INSERT, UPDATE, DELETE, CREATE TABLE, etc.)
/// Returns the number of rows affected.
#[tauri::command]
pub async fn execute_sql(
    state: State<'_, AppState>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<serde_json::Value, AppError> {
    let db = state.db.lock()
        .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
    let db = db.as_ref()
        .ok_or_else(|| AppError::Database("Database not initialized".to_string()))?;

    let rusqlite_params = json_to_rusqlite_params(&params);
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = rusqlite_params
        .iter()
        .map(|p| p as &dyn rusqlite::types::ToSql)
        .collect();

    let rows_affected = db.execute(&sql, param_refs.as_slice())
        .map_err(|e| AppError::Database(format!("SQL execute error: {}", e)))?;

    Ok(serde_json::json!({ "rowsAffected": rows_affected }))
}

/// Execute a read SQL statement (SELECT) and return rows as arrays of values.
/// Drizzle expects rows as arrays of column values.
#[tauri::command]
pub async fn select_sql(
    state: State<'_, AppState>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<Vec<Vec<serde_json::Value>>, AppError> {
    let db = state.db.lock()
        .map_err(|e| AppError::Database(format!("DB lock poisoned: {}", e)))?;
    let db = db.as_ref()
        .ok_or_else(|| AppError::Database("Database not initialized".to_string()))?;

    let rusqlite_params = json_to_rusqlite_params(&params);
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = rusqlite_params
        .iter()
        .map(|p| p as &dyn rusqlite::types::ToSql)
        .collect();

    let mut stmt = db.prepare(&sql)
        .map_err(|e| AppError::Database(format!("SQL prepare error: {}", e)))?;

    let column_count = stmt.column_count();

    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        let mut values = Vec::with_capacity(column_count);
        for i in 0..column_count {
            let value = row_value_to_json(row, i);
            values.push(value);
        }
        Ok(values)
    })
    .map_err(|e| AppError::Database(format!("SQL query error: {}", e)))?;

    let mut result = Vec::new();
    for row in rows {
        let row = row.map_err(|e| AppError::Database(format!("Row read error: {}", e)))?;
        result.push(row);
    }

    Ok(result)
}

/// Wrapper enum for owned rusqlite parameter values
enum OwnedValue {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
}

impl rusqlite::types::ToSql for OwnedValue {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        match self {
            OwnedValue::Null => Ok(rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Null)),
            OwnedValue::Integer(i) => Ok(rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Integer(*i))),
            OwnedValue::Real(f) => Ok(rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Real(*f))),
            OwnedValue::Text(s) => Ok(rusqlite::types::ToSqlOutput::Owned(rusqlite::types::Value::Text(s.clone()))),
        }
    }
}

/// Convert JSON params to rusqlite-compatible values
fn json_to_rusqlite_params(params: &[serde_json::Value]) -> Vec<OwnedValue> {
    params.iter().map(|v| match v {
        serde_json::Value::Null => OwnedValue::Null,
        serde_json::Value::Bool(b) => OwnedValue::Integer(if *b { 1 } else { 0 }),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                OwnedValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                OwnedValue::Real(f)
            } else {
                OwnedValue::Text(n.to_string())
            }
        }
        serde_json::Value::String(s) => OwnedValue::Text(s.clone()),
        other => OwnedValue::Text(other.to_string()),
    }).collect()
}

/// Convert a rusqlite row column to a serde_json::Value
fn row_value_to_json(row: &rusqlite::Row, idx: usize) -> serde_json::Value {
    // Try each type in order of likelihood
    if let Ok(v) = row.get::<_, Option<i64>>(idx) {
        match v {
            Some(i) => serde_json::Value::Number(i.into()),
            None => serde_json::Value::Null,
        }
    } else if let Ok(v) = row.get::<_, Option<f64>>(idx) {
        match v {
            Some(f) => serde_json::json!(f),
            None => serde_json::Value::Null,
        }
    } else if let Ok(v) = row.get::<_, Option<String>>(idx) {
        match v {
            Some(s) => serde_json::Value::String(s),
            None => serde_json::Value::Null,
        }
    } else {
        serde_json::Value::Null
    }
}
