use crate::data::repositories::classification_settings::{
    commit_classification_setting_mutations, ClassificationSettingMutation,
};
use crate::data::sqlite_pool::{
    is_recoverable_sqlite_error, reopen_sqlite_pool, wait_for_sqlite_pool,
};
use tauri::{AppHandle, Runtime};

pub async fn commit_classification_setting_mutations_with_recovery<R: Runtime>(
    app: &AppHandle<R>,
    mutations: &[ClassificationSettingMutation],
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(app).await?;
    match commit_classification_setting_mutations(&pool, mutations).await {
        Ok(()) => Ok(()),
        Err(error) if is_recoverable_sqlite_error(&error) => {
            let reopened_pool = reopen_sqlite_pool(app).await?;
            commit_classification_setting_mutations(&reopened_pool, mutations).await
        }
        Err(error) => Err(error),
    }
}
