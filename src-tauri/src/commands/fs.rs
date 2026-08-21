//! 通用文件系统操作 + 目录监听（notify 实现热重载）

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 读取二进制文件，返回 base64（用于 zip 备份包导入导出）
#[tauri::command]
pub fn read_binary_file(path: String) -> Result<String, String> {
    let data = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64_encode(&data))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(p, content).map_err(|e| e.to_string())
}

/// 写入二进制文件（base64 输入）
#[tauri::command]
pub fn write_binary_file(path: String, data_b64: String) -> Result<(), String> {
    let data = base64_decode(&data_b64)?;
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(p, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    let rd = fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in rd {
        let e = entry.map_err(|e| e.to_string())?;
        entries.push(DirEntry {
            name: e.file_name().to_string_lossy().to_string(),
            is_dir: e.path().is_dir(),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// 复制文件（P3 图片上传入库用：外部图片 -> books/{id}/assets/）
#[tauri::command]
pub fn copy_file(src: String, dest: String) -> Result<(), String> {
    let p = Path::new(&dest);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&src, p).map(|_| ()).map_err(|e| e.to_string())
}

/// 删除文件或目录（目录递归删除）
#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

// ============ 目录监听（Skill 热重载用） ============

pub struct WatchState(pub Mutex<HashMap<String, RecommendedWatcher>>);

#[tauri::command]
pub fn watch_dir(app: AppHandle, state: State<WatchState>, path: String) -> Result<(), String> {
    // 已在监听则跳过
    if state.0.lock().unwrap().contains_key(&path) {
        return Ok(());
    }
    // notify 6：recommended_watcher + 闭包 EventHandler
    let app_handle = app.clone();
    let root = path.clone();
    let mut w = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        let Ok(event) = res else { return };
        let kind = match event.kind {
            notify::EventKind::Create(_) => "create",
            notify::EventKind::Modify(_) => "modify",
            notify::EventKind::Remove(_) => "delete",
            _ => return,
        };
        if let Some(p) = event.paths.first() {
            let _ = app_handle.emit(
                "fs-change",
                serde_json::json!({
                    "root": root,
                    "path": p.to_string_lossy(),
                    "type": kind,
                }),
            );
        }
    })
    .map_err(|e| e.to_string())?;
    w.watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    state.0.lock().unwrap().insert(path, w);
    Ok(())
}

#[tauri::command]
pub fn unwatch_dir(state: State<WatchState>, path: String) -> Result<(), String> {
    // drop watcher 即停止
    state.0.lock().unwrap().remove(&path);
    Ok(())
}

// ============ 极简 base64（避免额外依赖） ============

const B64_TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64_TABLE[(n >> 18) as usize & 63] as char);
        out.push(B64_TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64_TABLE[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64_TABLE[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let input: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    for chunk in input.chunks(4) {
        let mut n: u32 = 0;
        for (i, &c) in chunk.iter().enumerate() {
            let v = B64_TABLE
                .iter()
                .position(|&t| t == c)
                .ok_or_else(|| format!("invalid base64 char: {}", c as char))?;
            n |= (v as u32) << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Ok(out)
}
