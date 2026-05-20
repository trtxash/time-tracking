use crate::data::repositories::app_settings::{commit_app_setting_mutations, AppSettingMutation};
use crate::data::sqlite_pool::{
    is_recoverable_sqlite_error, reopen_sqlite_pool, wait_for_sqlite_pool,
};
use tauri::{AppHandle, Runtime};

pub async fn commit_app_setting_mutations_with_recovery<R: Runtime>(
    app: &AppHandle<R>,
    mutations: &[AppSettingMutation],
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(app).await?;
    match commit_app_setting_mutations(&pool, mutations).await {
        Ok(()) => Ok(()),
        Err(error) if is_recoverable_sqlite_error(&error) => {
            let reopened_pool = reopen_sqlite_pool(app).await?;
            commit_app_setting_mutations(&reopened_pool, mutations).await
        }
        Err(error) => Err(error),
    }
}
