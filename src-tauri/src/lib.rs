mod commands;

use std::collections::HashMap;
use std::sync::Mutex;

use commands::db::DbState;
use commands::fs::WatchState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 仅在 dev 构建下开启 WebView2 远程调试端口（CDP），供自动化截图/测试连接。
    // 必须在创建 webview 之前设置，生产构建不开放以避免安全风险。
    #[cfg(debug_assertions)]
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--remote-debugging-port=9222",
        );
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(DbState(Mutex::new(None)))
        .manage(WatchState(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            // storage
            commands::storage::app_data_dir_path,
            commands::storage::home_dir,
            commands::storage::read_app_data,
            commands::storage::write_app_data,
            // fs
            commands::fs::read_file,
            commands::fs::read_binary_file,
            commands::fs::write_file,
            commands::fs::write_binary_file,
            commands::fs::ensure_dir,
            commands::fs::list_dir,
            commands::fs::delete_path,
            commands::fs::copy_file,
            commands::fs::watch_dir,
            commands::fs::unwatch_dir,
            // db
            commands::db::db_init,
            commands::db::db_exec,
            commands::db::db_query,
            commands::db::db_query_one,
            commands::db::db_transaction,
            // keystore
            commands::keystore::set_secret,
            commands::keystore::get_secret,
            commands::keystore::delete_secret,
            // shell
            commands::shell::open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
