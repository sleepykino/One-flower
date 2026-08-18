/// 系统交互命令（零依赖实现）
use std::process::Command;

/// 用系统默认浏览器打开 URL（方案 A：跳转 GitHub 下载页）
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let spawned = Command::new("cmd").args(["/C", "start", "", &url]).spawn();
    #[cfg(target_os = "macos")]
    let spawned = Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "linux")]
    let spawned = Command::new("xdg-open").arg(&url).spawn();

    match spawned {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("打开浏览器失败: {e}")),
    }
}
