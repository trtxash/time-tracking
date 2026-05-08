use crate::data::repositories::widget_state;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::widget::WidgetPlacement;
use tauri::{AppHandle, Runtime};

pub async fn load_widget_placement<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WidgetPlacement, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    widget_state::load_widget_placement(&pool)
        .await
        .map_err(|error| format!("failed to load widget placement: {error}"))
}

pub async fn save_widget_placement<R: Runtime>(
    app: &AppHandle<R>,
    placement: WidgetPlacement,
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(app).await?;
    widget_state::save_widget_placement(&pool, placement)
        .await
        .map_err(|error| format!("failed to save widget placement: {error}"))
}
