use crate::app;
use crate::data::backup::{self, RestoreStrategy};
use crate::domain::backup::BackupPreview;
use tauri::AppHandle;

#[tauri::command]
pub fn cmd_pick_backup_save_file(initial_path: Option<String>) -> Option<String> {
    backup::pick_backup_save_file(initial_path)
}

#[tauri::command]
pub fn cmd_pick_backup_file(initial_path: Option<String>) -> Option<String> {
    backup::pick_backup_file(initial_path)
}

#[tauri::command]
pub async fn cmd_export_backup(
    backup_path: Option<String>,
    app: AppHandle,
) -> Result<String, String> {
    backup::export_backup(backup_path, app).await
}

#[tauri::command]
pub async fn cmd_restore_backup(
    backup_path: String,
    restore_strategy: Option<RestoreStrategy>,
    app: AppHandle,
) -> Result<(), String> {
    app::backup::restore_backup_and_refresh(app, backup_path, restore_strategy.unwrap_or_default())
        .await
}

#[tauri::command]
pub async fn cmd_preview_backup(backup_path: String) -> Result<BackupPreview, String> {
    backup::preview_backup(backup_path).await
}
