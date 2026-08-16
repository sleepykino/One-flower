//! SQLite 操作（rusqlite + WAL + FTS5），连接由 Mutex 保护，前端 WriteQueue 保证写入串行

use rusqlite::types::Value as SqlValue;
use rusqlite::Connection;
use serde_json::{Map, Value as Json};
use std::sync::Mutex;
use tauri::State;

pub struct DbState(pub Mutex<Option<Connection>>);

#[derive(serde::Deserialize)]
pub struct TxStatement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Json>,
}

/// serde_json::Value → SQLite 值
fn json_to_sql(v: &Json) -> SqlValue {
    match v {
        Json::Null => SqlValue::Null,
        Json::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        Json::Number(n) => n
            .as_i64()
            .map(SqlValue::Integer)
            .unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0))),
        Json::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

/// SQLite 值 → serde_json::Value
fn sql_to_json(v: &SqlValue) -> Json {
    match v {
        SqlValue::Null => Json::Null,
        SqlValue::Integer(i) => Json::from(*i),
        SqlValue::Real(f) => Json::from(*f),
        SqlValue::Text(s) => Json::String(s.clone()),
        SqlValue::Blob(b) => Json::String(String::from_utf8_lossy(b).to_string()),
    }
}

fn query_rows(conn: &Connection, sql: &str, params: Vec<Json>) -> Result<Vec<Json>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let sql_params: Vec<SqlValue> = params.iter().map(json_to_sql).collect();
    let mut rows = stmt
        .query(rusqlite::params_from_iter(sql_params))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut m = Map::new();
        for (i, name) in names.iter().enumerate() {
            let v: SqlValue = row.get(i).map_err(|e| e.to_string())?;
            m.insert(name.clone(), sql_to_json(&v));
        }
        out.push(Json::Object(m));
    }
    Ok(out)
}

fn exec_one(conn: &Connection, sql: &str, params: Vec<Json>) -> Result<(), String> {
    if params.is_empty() {
        // 支持多语句（迁移用）
        conn.execute_batch(sql).map_err(|e| e.to_string())
    } else {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let sql_params: Vec<SqlValue> = params.iter().map(json_to_sql).collect();
        stmt.execute(rusqlite::params_from_iter(sql_params))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
pub fn db_init(state: State<DbState>, path: String) -> Result<(), String> {
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(conn);
    Ok(())
}

#[tauri::command]
pub fn db_exec(state: State<DbState>, sql: String, params: Option<Vec<Json>>) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("数据库未初始化")?;
    exec_one(conn, &sql, params.unwrap_or_default())
}

#[tauri::command]
pub fn db_query(
    state: State<DbState>,
    sql: String,
    params: Option<Vec<Json>>,
) -> Result<Vec<Json>, String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("数据库未初始化")?;
    query_rows(conn, &sql, params.unwrap_or_default())
}

#[tauri::command]
pub fn db_query_one(
    state: State<DbState>,
    sql: String,
    params: Option<Vec<Json>>,
) -> Result<Json, String> {
    let rows = db_query(state, sql, params)?;
    Ok(rows.into_iter().next().unwrap_or(Json::Null))
}

/// 批量语句在单个事务中执行，任一失败全部回滚
#[tauri::command]
pub fn db_transaction(
    state: State<DbState>,
    statements: Vec<TxStatement>,
) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    let conn = guard.as_mut().ok_or("数据库未初始化")?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for stmt in statements {
        let params: Vec<SqlValue> = stmt.params.iter().map(json_to_sql).collect();
        if params.is_empty() {
            tx.execute_batch(&stmt.sql).map_err(|e| e.to_string())?;
        } else {
            tx.prepare(&stmt.sql)
                .map_err(|e| e.to_string())?
                .execute(rusqlite::params_from_iter(params))
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}
