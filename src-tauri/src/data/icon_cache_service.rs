use crate::data::repositories::icon_cache::fetch_icon_map;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use std::collections::HashMap;
use tauri::{AppHandle, Runtime};

pub async fn load_icon_map<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<HashMap<String, String>, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    fetch_icon_map(&pool).await
}
