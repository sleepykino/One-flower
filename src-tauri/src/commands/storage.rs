//! 应用数据目录读写（相对 app_data_dir 的路径）

use std::fs;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn app_data_dir_path(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// 用户 home 目录（Skill 目录解析用）
#[tauri::command]
pub fn home_dir() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("无法获取用户目录")?;
    Ok(home.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_app_data(app: AppHandle, path: String) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let full = dir.join(&path);
    fs::read_to_string(full).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_app_data(app: AppHandle, path: String, content: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let full = dir.join(&path);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(full, content).map_err(|e| e.to_string())
}
