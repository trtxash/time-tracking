use crate::data::sqlite_pool;
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn cmd_reopen_sqlite_pool<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    sqlite_pool::reopen_sqlite_pool(&app).await.map(|_| ())
}
