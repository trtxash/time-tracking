use crate::data::schema;
use crate::platform::app_paths;
use futures_util::future::BoxFuture;
use serde::Serialize;
use sqlx::error::BoxDynError;
use sqlx::migrate::{Migration as SqlxMigration, MigrationSource, MigrationType, Migrator};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Row, Sqlite};
use std::collections::BTreeMap;
use std::fs::{self, create_dir_all};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_sql::{DbInstances, DbPool, MigrationKind};
use tokio::time::{sleep, Duration};

pub const SQLITE_DB_NAME: &str = "sqlite:patina.db";
const SQLITE_DB_FILE_NAME: &str = "patina.db";
const LEGACY_SQLITE_DB_FILE_NAME: &str = "timetracker.db";
const MIGRATION_STATE_FILE_NAME: &str = "migration-state.json";

#[derive(Debug)]
struct InlineMigrationList(Vec<tauri_plugin_sql::Migration>);

impl MigrationSource<'static> for InlineMigrationList {
    fn resolve(self) -> BoxFuture<'static, Result<Vec<SqlxMigration>, BoxDynError>> {
        Box::pin(async move {
            let mut migrations = Vec::new();
            for migration in self.0 {
                if matches!(migration.kind, MigrationKind::Up) {
                    migrations.push(SqlxMigration::new(
                        migration.version,
                        migration.description.into(),
                        MigrationType::ReversibleUp,
                        migration.sql.into(),
                        false,
                    ));
                }
            }
            Ok(migrations)
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MigrationState<'a> {
    from_identifier: &'a str,
    from_path: String,
    to_path: String,
    migrated_at: u64,
    app_version: String,
    source_size: u64,
    source_modified_time: Option<u64>,
    integrity_check_result: String,
    legacy_source_cleanup: &'a str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LegacyCleanupOutcome {
    NoLegacyDir,
    RemovedLegacyDir,
    KeptUnknownFiles,
}

impl LegacyCleanupOutcome {
    fn marker_value(self) -> &'static str {
        match self {
            Self::NoLegacyDir | Self::RemovedLegacyDir => "completed",
            Self::KeptUnknownFiles => "known-files-removed-unknown-files-kept",
        }
    }
}

fn expected_migration_metadata() -> Vec<(i64, &'static str, Vec<u8>)> {
    schema::tracker_migrations()
        .into_iter()
        .map(|migration| {
            let sqlx_migration = SqlxMigration::new(
                migration.version,
                migration.description.into(),
                MigrationType::ReversibleUp,
                migration.sql.into(),
                false,
            );
            (
                migration.version,
                migration.description,
                sqlx_migration.checksum.into_owned(),
            )
        })
        .collect()
}

fn resolve_product_db_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_path = app_paths::product_roaming_data_dir(app)?;
    create_dir_all(&app_path).map_err(|error| {
        format!(
            "failed to create app data dir `{}`: {error}",
            app_path.display()
        )
    })?;
    Ok(app_path.join(SQLITE_DB_FILE_NAME))
}

async fn open_single_connection_sqlite_pool(
    db_path: &Path,
    create_if_missing: bool,
) -> Result<Pool<Sqlite>, String> {
    let connect_options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(create_if_missing)
        .pragma("busy_timeout", "5000")
        .pragma("foreign_keys", "ON");

    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(connect_options)
        .await
        .map_err(|error| format!("failed to open sqlite db `{}`: {error}", db_path.display()))
}

pub fn is_recoverable_sqlite_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("database is locked")
        || normalized.contains("database is busy")
        || normalized.contains("sqlite_busy")
        || normalized.contains("sqlite_locked")
        || normalized.contains("pool closed")
        || normalized.contains("pooltimedout")
}

pub async fn reopen_sqlite_pool<R: Runtime>(app: &AppHandle<R>) -> Result<Pool<Sqlite>, String> {
    let db_path = resolve_product_db_path(app)?;
    let next_pool = open_single_connection_sqlite_pool(&db_path, true).await?;

    register_sqlite_pool(app, next_pool.clone()).await?;

    Ok(next_pool)
}

async fn register_sqlite_pool<R: Runtime>(
    app: &AppHandle<R>,
    next_pool: Pool<Sqlite>,
) -> Result<(), String> {
    let instances = app
        .try_state::<DbInstances>()
        .ok_or_else(|| "sqlite db instances state is not available".to_string())?;

    let previous_pool = {
        let mut instances = instances.0.write().await;
        match instances.insert(
            SQLITE_DB_NAME.to_string(),
            DbPool::Sqlite(next_pool.clone()),
        ) {
            Some(DbPool::Sqlite(pool)) => Some(pool),
            _ => None,
        }
    };

    if let Some(pool) = previous_pool {
        pool.close().await;
    }

    Ok(())
}

pub async fn initialize_app_sqlite<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let db_path = resolve_product_db_path(app)?;
    let target_existed_before = db_path.exists();
    let legacy_dir = app_paths::legacy_roaming_data_dir(app)?;
    let legacy_db_path = legacy_dir.join(LEGACY_SQLITE_DB_FILE_NAME);
    let migration_state_path = migration_state_path(&db_path)?;
    let mut migrated_this_start = false;

    if !target_existed_before && legacy_db_path.exists() {
        migrate_legacy_database(app, &legacy_db_path, &db_path).await?;
        migrated_this_start = true;
    }

    let pool = open_single_connection_sqlite_pool(&db_path, true).await?;

    if repair_legacy_schema_before_baseline_normalization(&pool).await? {
        eprintln!("[sql] repaired legacy sqlite schema before baseline normalization");
    }

    if normalize_current_baseline_migration_history_for_pool(&pool).await? {
        eprintln!("[sql] normalized sqlite migration history to the current baseline");
    }

    run_current_migrations(&pool).await?;

    if normalize_current_baseline_migration_history_for_pool(&pool).await? {
        eprintln!("[sql] normalized sqlite migration history to the current baseline");
    }

    if !has_current_baseline_schema(&pool).await? {
        return Err(format!(
            "sqlite schema validation failed for `{}`",
            db_path.display()
        ));
    }

    register_sqlite_pool(app, pool).await?;
    if migrated_this_start || migration_state_path.exists() {
        let target_dir = db_path
            .parent()
            .ok_or_else(|| format!("failed to resolve sqlite db parent `{}`", db_path.display()))?;
        match cleanup_legacy_roaming_data_dir(&legacy_dir, target_dir) {
            Ok(outcome) => {
                if let Err(error) =
                    update_migration_cleanup_state(&migration_state_path, outcome.marker_value())
                {
                    eprintln!("[sql] failed to update sqlite migration cleanup state: {error}");
                }
            }
            Err(error) => {
                eprintln!("[sql] failed to cleanup legacy app data dir: {error}");
            }
        }
    } else if target_existed_before && legacy_db_path.exists() {
        eprintln!(
            "[sql] legacy sqlite db also exists, but no migration marker was found; keeping legacy data untouched"
        );
    }

    Ok(())
}

async fn run_current_migrations(pool: &Pool<Sqlite>) -> Result<(), String> {
    let migrator = Migrator::new(InlineMigrationList(schema::tracker_migrations()))
        .await
        .map_err(|error| format!("failed to prepare sqlite migrations: {error}"))?;
    migrator
        .run(pool)
        .await
        .map_err(|error| format!("failed to run sqlite migrations: {error}"))
}

async fn migrate_legacy_database<R: Runtime>(
    app: &AppHandle<R>,
    legacy_db_path: &Path,
    db_path: &Path,
) -> Result<(), String> {
    let source_metadata = fs::metadata(legacy_db_path).map_err(|error| {
        format!(
            "failed to inspect legacy sqlite db `{}`: {error}",
            legacy_db_path.display()
        )
    })?;

    let source_pool = open_single_connection_sqlite_pool(legacy_db_path, false).await?;
    let integrity_check_result = sqlite_integrity_check(&source_pool).await?;
    if integrity_check_result != "ok" {
        source_pool.close().await;
        return Err(format!(
            "legacy sqlite integrity check failed for `{}`: {integrity_check_result}",
            legacy_db_path.display()
        ));
    }

    let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&source_pool)
        .await
        .map_err(|error| {
            format!(
                "failed to checkpoint legacy sqlite WAL `{}`: {error}",
                legacy_db_path.display()
            )
        })?;
    let source_core_counts = core_table_row_counts(&source_pool).await?;
    source_pool.close().await;

    let temp_path = db_path.with_extension("db.migrating");
    if temp_path.exists() {
        fs::remove_file(&temp_path).map_err(|error| {
            format!(
                "failed to remove stale sqlite migration temp file `{}`: {error}",
                temp_path.display()
            )
        })?;
    }

    fs::copy(legacy_db_path, &temp_path).map_err(|error| {
        format!(
            "failed to copy legacy sqlite db `{}` to `{}`: {error}",
            legacy_db_path.display(),
            temp_path.display()
        )
    })?;

    let target_pool = open_single_connection_sqlite_pool(&temp_path, false).await?;
    let target_integrity = sqlite_integrity_check(&target_pool).await?;
    let target_core_counts = core_table_row_counts(&target_pool).await?;
    target_pool.close().await;
    if target_integrity != "ok" {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "migrated sqlite integrity check failed for `{}`: {target_integrity}",
            temp_path.display()
        ));
    }
    if target_core_counts != source_core_counts {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "migrated sqlite row count comparison failed for `{}`",
            temp_path.display()
        ));
    }

    fs::rename(&temp_path, db_path).map_err(|error| {
        format!(
            "failed to promote migrated sqlite db `{}` to `{}`: {error}",
            temp_path.display(),
            db_path.display()
        )
    })?;

    write_migration_state(
        app,
        legacy_db_path,
        db_path,
        &source_metadata,
        &integrity_check_result,
    )?;

    Ok(())
}

async fn sqlite_integrity_check(pool: &Pool<Sqlite>) -> Result<String, String> {
    sqlx::query_scalar::<_, String>("PRAGMA integrity_check")
        .fetch_one(pool)
        .await
        .map_err(|error| format!("failed to run sqlite integrity check: {error}"))
}

async fn core_table_row_counts(pool: &Pool<Sqlite>) -> Result<BTreeMap<&'static str, i64>, String> {
    let mut counts = BTreeMap::new();
    for (table_name, query) in [
        ("sessions", "SELECT COUNT(*) FROM sessions"),
        (
            "session_title_samples",
            "SELECT COUNT(*) FROM session_title_samples",
        ),
        ("settings", "SELECT COUNT(*) FROM settings"),
        ("icon_cache", "SELECT COUNT(*) FROM icon_cache"),
    ] {
        if table_exists(pool, table_name).await? {
            let count = sqlx::query_scalar::<_, i64>(query)
                .fetch_one(pool)
                .await
                .map_err(|error| {
                    format!("failed to count sqlite table `{table_name}` rows: {error}")
                })?;
            counts.insert(table_name, count);
        }
    }
    Ok(counts)
}

fn write_migration_state<R: Runtime>(
    app: &AppHandle<R>,
    legacy_db_path: &Path,
    db_path: &Path,
    source_metadata: &fs::Metadata,
    integrity_check_result: &str,
) -> Result<(), String> {
    let marker_path = migration_state_path(db_path)?;
    let source_modified_time = source_metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    let state = MigrationState {
        from_identifier: app_paths::app_profile(app).legacy_identifier(),
        from_path: legacy_db_path.display().to_string(),
        to_path: db_path.display().to_string(),
        migrated_at: crate::app::runtime::now_ms(),
        app_version: app.package_info().version.to_string(),
        source_size: source_metadata.len(),
        source_modified_time,
        integrity_check_result: integrity_check_result.to_string(),
        legacy_source_cleanup: "pending",
    };
    let json = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("failed to serialize sqlite migration state: {error}"))?;
    fs::write(&marker_path, json).map_err(|error| {
        format!(
            "failed to write sqlite migration state `{}`: {error}",
            marker_path.display()
        )
    })
}

fn migration_state_path(db_path: &Path) -> Result<PathBuf, String> {
    Ok(db_path
        .parent()
        .ok_or_else(|| {
            format!(
                "failed to resolve migrated sqlite parent for `{}`",
                db_path.display()
            )
        })?
        .join(MIGRATION_STATE_FILE_NAME))
}

fn update_migration_cleanup_state(marker_path: &Path, cleanup_state: &str) -> Result<(), String> {
    if !marker_path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(marker_path).map_err(|error| {
        format!(
            "failed to read sqlite migration state `{}`: {error}",
            marker_path.display()
        )
    })?;
    let mut value = serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| {
        format!(
            "failed to parse sqlite migration state `{}`: {error}",
            marker_path.display()
        )
    })?;
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "legacySourceCleanup".to_string(),
            serde_json::Value::String(cleanup_state.to_string()),
        );
        object.insert(
            "legacySourceCleanupUpdatedAt".to_string(),
            serde_json::Value::Number(crate::app::runtime::now_ms().into()),
        );
    }

    let json = serde_json::to_string_pretty(&value).map_err(|error| {
        format!(
            "failed to serialize sqlite migration state `{}`: {error}",
            marker_path.display()
        )
    })?;
    fs::write(marker_path, json).map_err(|error| {
        format!(
            "failed to update sqlite migration state `{}`: {error}",
            marker_path.display()
        )
    })
}

fn cleanup_legacy_roaming_data_dir(
    legacy_dir: &Path,
    target_dir: &Path,
) -> Result<LegacyCleanupOutcome, String> {
    if !legacy_dir.exists() {
        return Ok(LegacyCleanupOutcome::NoLegacyDir);
    }

    move_legacy_backup_dir(legacy_dir, target_dir)?;

    for file_name in [
        LEGACY_SQLITE_DB_FILE_NAME,
        "timetracker.db-wal",
        "timetracker.db-shm",
    ] {
        let path = legacy_dir.join(file_name);
        if path.exists() {
            fs::remove_file(&path).map_err(|error| {
                format!(
                    "failed to remove legacy sqlite file `{}`: {error}",
                    path.display()
                )
            })?;
        }
    }

    let remote_temp_dir = legacy_dir.join("remote-backup-temp");
    if remote_temp_dir.exists() {
        fs::remove_dir_all(&remote_temp_dir).map_err(|error| {
            format!(
                "failed to remove legacy remote backup temp dir `{}`: {error}",
                remote_temp_dir.display()
            )
        })?;
    }

    match fs::remove_dir(legacy_dir) {
        Ok(()) => Ok(LegacyCleanupOutcome::RemovedLegacyDir),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(LegacyCleanupOutcome::RemovedLegacyDir)
        }
        Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => {
            Ok(LegacyCleanupOutcome::KeptUnknownFiles)
        }
        Err(error) => Err(format!(
            "failed to remove empty legacy app data dir `{}`: {error}",
            legacy_dir.display()
        )),
    }
}

fn move_legacy_backup_dir(legacy_dir: &Path, target_dir: &Path) -> Result<(), String> {
    let legacy_backup_dir = legacy_dir.join("backups");
    if !legacy_backup_dir.exists() {
        return Ok(());
    }

    let target_backup_dir = target_dir.join("backups");
    create_dir_all(&target_backup_dir).map_err(|error| {
        format!(
            "failed to create migrated backup dir `{}`: {error}",
            target_backup_dir.display()
        )
    })?;

    for entry in fs::read_dir(&legacy_backup_dir).map_err(|error| {
        format!(
            "failed to read legacy backup dir `{}`: {error}",
            legacy_backup_dir.display()
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "failed to inspect legacy backup dir `{}` entry: {error}",
                legacy_backup_dir.display()
            )
        })?;
        let source_path = entry.path();
        let target_path = target_backup_dir.join(entry.file_name());
        if target_path.exists() {
            continue;
        }
        fs::rename(&source_path, &target_path).map_err(|error| {
            format!(
                "failed to move legacy backup `{}` to `{}`: {error}",
                source_path.display(),
                target_path.display()
            )
        })?;
    }

    match fs::remove_dir(&legacy_backup_dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => Ok(()),
        Err(error) => Err(format!(
            "failed to remove empty legacy backup dir `{}`: {error}",
            legacy_backup_dir.display()
        )),
    }
}

pub fn cleanup_webview_compat_dirs<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let legacy_local_dir = app_paths::legacy_local_data_dir(app)?;
    remove_dir_all_if_exists(
        &legacy_local_dir.join("EBWebView"),
        "legacy WebView data dir",
    )?;

    remove_empty_dir_if_exists(&legacy_local_dir, "legacy local app data dir")?;

    let obsolete_product_webview_root = app_paths::product_local_data_dir(app)?.join("WebView");
    remove_dir_all_if_exists(
        &obsolete_product_webview_root.join("EBWebView"),
        "obsolete pre-release WebView data dir",
    )?;
    remove_empty_dir_if_exists(
        &obsolete_product_webview_root,
        "obsolete pre-release WebView root",
    )
}

fn remove_dir_all_if_exists(path: &Path, label: &str) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    fs::remove_dir_all(path)
        .map_err(|error| format!("failed to remove {label} `{}`: {error}", path.display()))
}

fn remove_empty_dir_if_exists(path: &Path, label: &str) -> Result<(), String> {
    match fs::remove_dir(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => Ok(()),
        Err(error) => Err(format!(
            "failed to remove empty {label} `{}`: {error}",
            path.display()
        )),
    }
}

async fn table_exists(pool: &Pool<Sqlite>, table_name: &str) -> Result<bool, String> {
    sqlx::query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
        .bind(table_name)
        .fetch_optional(pool)
        .await
        .map(|row| row.is_some())
        .map_err(|error| format!("failed to inspect sqlite table `{table_name}`: {error}"))
}

async fn table_has_columns(
    pool: &Pool<Sqlite>,
    table_name: &str,
    required_columns: &[&str],
) -> Result<bool, String> {
    let pragma = match table_name {
        "sessions" => "PRAGMA table_info(sessions)",
        "session_title_samples" => "PRAGMA table_info(session_title_samples)",
        "settings" => "PRAGMA table_info(settings)",
        "icon_cache" => "PRAGMA table_info(icon_cache)",
        "tool_reminders" => "PRAGMA table_info(tool_reminders)",
        "tool_timers" => "PRAGMA table_info(tool_timers)",
        "tool_timer_laps" => "PRAGMA table_info(tool_timer_laps)",
        "tool_pomodoro_runs" => "PRAGMA table_info(tool_pomodoro_runs)",
        "tool_daily_stats" => "PRAGMA table_info(tool_daily_stats)",
        "tool_software_reminder_rules" => "PRAGMA table_info(tool_software_reminder_rules)",
        _ => {
            return Err(format!(
                "unsupported schema inspection table `{table_name}`"
            ))
        }
    };

    let rows = sqlx::query(pragma).fetch_all(pool).await.map_err(|error| {
        format!("failed to inspect sqlite table `{table_name}` columns: {error}")
    })?;
    let columns = rows
        .iter()
        .map(|row| row.get::<String, _>("name"))
        .collect::<Vec<_>>();

    Ok(required_columns
        .iter()
        .all(|required| columns.iter().any(|column| column == required)))
}

async fn sessions_has_column(pool: &Pool<Sqlite>, column_name: &str) -> Result<bool, String> {
    table_has_columns(pool, "sessions", &[column_name]).await
}

async fn sessions_has_index(pool: &Pool<Sqlite>, index_name: &str) -> Result<bool, String> {
    table_has_index(pool, "sessions", index_name).await
}

async fn table_has_index(
    pool: &Pool<Sqlite>,
    table_name: &str,
    index_name: &str,
) -> Result<bool, String> {
    let pragma = match table_name {
        "sessions" => "PRAGMA index_list(sessions)",
        "session_title_samples" => "PRAGMA index_list(session_title_samples)",
        "tool_reminders" => "PRAGMA index_list(tool_reminders)",
        "tool_timers" => "PRAGMA index_list(tool_timers)",
        "tool_timer_laps" => "PRAGMA index_list(tool_timer_laps)",
        "tool_pomodoro_runs" => "PRAGMA index_list(tool_pomodoro_runs)",
        "tool_daily_stats" => "PRAGMA index_list(tool_daily_stats)",
        "tool_software_reminder_rules" => "PRAGMA index_list(tool_software_reminder_rules)",
        _ => return Err(format!("unsupported index inspection table `{table_name}`")),
    };

    let rows = sqlx::query(pragma)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to inspect {table_name} indexes: {error}"))?;

    Ok(rows
        .iter()
        .any(|row| row.get::<String, _>("name") == index_name))
}

async fn ensure_sessions_continuity_group_start_time(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if sessions_has_column(pool, "continuity_group_start_time").await? {
        return Ok(false);
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start sqlite legacy schema repair: {error}"))?;

    sqlx::query("ALTER TABLE sessions ADD COLUMN continuity_group_start_time INTEGER")
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            format!(
                "failed to add sessions.continuity_group_start_time during schema repair: {error}"
            )
        })?;
    sqlx::query(
        "UPDATE sessions
         SET continuity_group_start_time = start_time
         WHERE continuity_group_start_time IS NULL",
    )
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        format!(
            "failed to backfill sessions.continuity_group_start_time during schema repair: {error}"
        )
    })?;

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit sqlite legacy schema repair: {error}"))?;

    Ok(true)
}

async fn ensure_current_indexes(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let mut changed = false;

    if !sessions_has_index(pool, "idx_sessions_date").await? {
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(start_time)")
            .execute(pool)
            .await
            .map_err(|error| format!("failed to create sessions date index: {error}"))?;
        changed = true;
    }

    if !sessions_has_index(pool, "idx_sessions_single_active").await? {
        sqlx::query(
            "UPDATE sessions
             SET end_time = start_time,
                 duration = 0
             WHERE end_time IS NULL
               AND id NOT IN (
                 SELECT id
                 FROM sessions
                 WHERE end_time IS NULL
                 ORDER BY start_time DESC, id DESC
                 LIMIT 1
               )",
        )
        .execute(pool)
        .await
        .map_err(|error| {
            format!("failed to seal duplicate active sessions before index repair: {error}")
        })?;
        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_single_active
             ON sessions((1))
             WHERE end_time IS NULL",
        )
        .execute(pool)
        .await
        .map_err(|error| format!("failed to create single active session index: {error}"))?;
        changed = true;
    }

    Ok(changed)
}

async fn ensure_session_title_samples_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let mut changed = false;

    if !table_exists(pool, "session_title_samples").await? {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS session_title_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
        )
        .execute(pool)
        .await
        .map_err(|error| format!("failed to create session_title_samples table: {error}"))?;
        changed = true;
    }

    if !table_has_index(
        pool,
        "session_title_samples",
        "idx_session_title_samples_session_time",
    )
    .await?
    {
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_session_title_samples_session_time
             ON session_title_samples(session_id, start_time)",
        )
        .execute(pool)
        .await
        .map_err(|error| {
            format!("failed to create session_title_samples session/time index: {error}")
        })?;
        changed = true;
    }

    if !table_has_index(
        pool,
        "session_title_samples",
        "idx_session_title_samples_time",
    )
    .await?
    {
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_session_title_samples_time
             ON session_title_samples(start_time, end_time)",
        )
        .execute(pool)
        .await
        .map_err(|error| format!("failed to create session_title_samples time index: {error}"))?;
        changed = true;
    }

    let inserted = sqlx::query(
        "INSERT INTO session_title_samples (session_id, title, start_time, end_time)
         SELECT id, TRIM(window_title), start_time, end_time
         FROM sessions
         WHERE TRIM(COALESCE(window_title, '')) <> ''
           AND NOT EXISTS (
             SELECT 1
             FROM session_title_samples
             WHERE session_title_samples.session_id = sessions.id
           )",
    )
    .execute(pool)
    .await
    .map_err(|error| format!("failed to backfill legacy title samples: {error}"))?
    .rows_affected();

    Ok(changed || inserted > 0)
}

async fn repair_legacy_schema_before_baseline_normalization(
    pool: &Pool<Sqlite>,
) -> Result<bool, String> {
    if !table_exists(pool, "sessions").await? {
        return Ok(false);
    }

    let mut changed = ensure_sessions_continuity_group_start_time(pool).await?;
    changed = ensure_session_title_samples_schema(pool).await? || changed;

    if has_current_baseline_schema(pool).await? {
        return Ok(changed);
    }

    let sessions_base_ready = table_has_columns(
        pool,
        "sessions",
        &[
            "id",
            "app_name",
            "exe_name",
            "window_title",
            "start_time",
            "end_time",
            "duration",
            "continuity_group_start_time",
        ],
    )
    .await?;

    if sessions_base_ready {
        changed = ensure_current_indexes(pool).await? || changed;
    }

    Ok(changed)
}

async fn has_current_baseline_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if !table_exists(pool, "sessions").await?
        || !table_exists(pool, "settings").await?
        || !table_exists(pool, "icon_cache").await?
    {
        return Ok(false);
    }

    let sessions_ready = table_has_columns(
        pool,
        "sessions",
        &[
            "id",
            "app_name",
            "exe_name",
            "window_title",
            "start_time",
            "end_time",
            "duration",
            "continuity_group_start_time",
        ],
    )
    .await?;
    let title_samples_ready = table_has_columns(
        pool,
        "session_title_samples",
        &["id", "session_id", "title", "start_time", "end_time"],
    )
    .await?;
    let settings_ready = table_has_columns(pool, "settings", &["key", "value"]).await?;
    let icon_cache_ready = table_has_columns(
        pool,
        "icon_cache",
        &["exe_name", "icon_base64", "last_updated"],
    )
    .await?;
    let date_index_ready = sessions_has_index(pool, "idx_sessions_date").await?;
    let active_index_ready = sessions_has_index(pool, "idx_sessions_single_active").await?;
    let title_sample_session_index_ready = table_has_index(
        pool,
        "session_title_samples",
        "idx_session_title_samples_session_time",
    )
    .await?;
    let title_sample_time_index_ready = table_has_index(
        pool,
        "session_title_samples",
        "idx_session_title_samples_time",
    )
    .await?;

    Ok(sessions_ready
        && title_samples_ready
        && settings_ready
        && icon_cache_ready
        && date_index_ready
        && active_index_ready
        && title_sample_session_index_ready
        && title_sample_time_index_ready)
}

async fn has_base_tools_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if !table_exists(pool, "tool_reminders").await?
        || !table_exists(pool, "tool_timers").await?
        || !table_exists(pool, "tool_timer_laps").await?
        || !table_exists(pool, "tool_pomodoro_runs").await?
        || !table_exists(pool, "tool_daily_stats").await?
    {
        return Ok(false);
    }

    let reminders_ready = table_has_columns(
        pool,
        "tool_reminders",
        &[
            "id",
            "label",
            "scheduled_at",
            "created_at",
            "status",
            "fired_at",
            "cancelled_at",
        ],
    )
    .await?;
    let timers_ready = table_has_columns(
        pool,
        "tool_timers",
        &[
            "id",
            "mode",
            "label",
            "duration_ms",
            "accumulated_ms",
            "started_at",
            "paused_at",
            "completed_at",
            "status",
            "created_at",
            "updated_at",
        ],
    )
    .await?;
    let laps_ready = table_has_columns(
        pool,
        "tool_timer_laps",
        &[
            "id",
            "timer_id",
            "lap_index",
            "started_at",
            "ended_at",
            "duration_ms",
        ],
    )
    .await?;
    let pomodoros_ready = table_has_columns(
        pool,
        "tool_pomodoro_runs",
        &[
            "id",
            "phase",
            "status",
            "cycle_index",
            "focus_ms",
            "short_break_ms",
            "long_break_ms",
            "long_break_every",
            "phase_started_at",
            "phase_paused_at",
            "phase_remaining_ms",
            "completed_focus_count",
            "created_at",
            "updated_at",
        ],
    )
    .await?;
    let daily_ready = table_has_columns(
        pool,
        "tool_daily_stats",
        &["date_key", "completed_pomodoros", "updated_at"],
    )
    .await?;
    let reminder_index_ready =
        table_has_index(pool, "tool_reminders", "idx_tool_reminders_schedule_status").await?;
    let timer_index_ready =
        table_has_index(pool, "tool_timers", "idx_tool_timers_status_updated").await?;
    let lap_index_ready =
        table_has_index(pool, "tool_timer_laps", "idx_tool_timer_laps_timer_id").await?;
    let pomodoro_index_ready = table_has_index(
        pool,
        "tool_pomodoro_runs",
        "idx_tool_pomodoro_runs_status_updated",
    )
    .await?;
    let daily_index_ready =
        table_has_index(pool, "tool_daily_stats", "idx_tool_daily_stats_updated").await?;

    Ok(reminders_ready
        && timers_ready
        && laps_ready
        && pomodoros_ready
        && daily_ready
        && reminder_index_ready
        && timer_index_ready
        && lap_index_ready
        && pomodoro_index_ready
        && daily_index_ready)
}

async fn has_software_reminder_rules_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if !table_exists(pool, "tool_software_reminder_rules").await? {
        return Ok(false);
    }

    let software_rules_ready = table_has_columns(
        pool,
        "tool_software_reminder_rules",
        &[
            "id",
            "app_name",
            "exe_name",
            "limit_ms",
            "message",
            "created_at",
            "updated_at",
            "disabled_at",
            "last_fired_date_key",
        ],
    )
    .await?;
    let software_rules_index_ready = table_has_index(
        pool,
        "tool_software_reminder_rules",
        "idx_tool_software_reminder_rules_active",
    )
    .await?;
    let sessions_app_usage_index_ready =
        table_has_index(pool, "sessions", "idx_sessions_app_usage_time").await?;
    let sessions_exe_usage_index_ready =
        table_has_index(pool, "sessions", "idx_sessions_exe_usage_time").await?;

    Ok(software_rules_ready
        && software_rules_index_ready
        && sessions_app_usage_index_ready
        && sessions_exe_usage_index_ready)
}

async fn normalize_current_baseline_migration_history_for_pool(
    pool: &Pool<Sqlite>,
) -> Result<bool, String> {
    if !table_exists(pool, "_sqlx_migrations").await? {
        return Ok(false);
    }

    if !has_current_baseline_schema(pool).await? {
        return Ok(false);
    }

    let mut expected = expected_migration_metadata();
    if !has_base_tools_schema(pool).await? {
        expected.truncate(1);
    } else if !has_software_reminder_rules_schema(pool).await? {
        expected.truncate(2);
    }
    if expected.is_empty() {
        return Ok(false);
    }

    let applied_rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to load applied sqlite migrations: {error}"))?;

    let already_normalized = applied_rows.len() == expected.len()
        && expected.iter().all(|(version, description, checksum)| {
            applied_rows.iter().any(|row| {
                row.get::<i64, _>("version") == *version
                    && row.get::<String, _>("description") == *description
                    && row.get::<Vec<u8>, _>("checksum") == *checksum
            })
        });

    if already_normalized {
        return Ok(false);
    }

    let mut tx = pool.begin().await.map_err(|error| {
        format!("failed to start sqlite migration history normalization: {error}")
    })?;
    sqlx::query("DELETE FROM _sqlx_migrations")
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to clear sqlite migration history: {error}"))?;
    for (version, description, checksum) in expected {
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (?, ?, 1, ?, 0)",
        )
        .bind(version)
        .bind(description)
        .bind(checksum)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to write sqlite current migration history: {error}"))?;
    }
    tx.commit().await.map_err(|error| {
        format!("failed to commit sqlite migration history normalization: {error}")
    })?;

    Ok(true)
}

pub async fn wait_for_sqlite_pool<R: Runtime>(app: &AppHandle<R>) -> Result<Pool<Sqlite>, String> {
    let mut wait_cycles: u64 = 0;

    loop {
        if let Some(instances) = app.try_state::<DbInstances>() {
            let instances = instances.0.read().await;
            if let Some(DbPool::Sqlite(pool)) = instances.get(SQLITE_DB_NAME) {
                return Ok(pool.clone());
            }
        }

        wait_cycles += 1;
        if wait_cycles > 300 {
            return Err("sqlite pool not available in time".to_string());
        }

        sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Executor, SqlitePool};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("patina-{label}-{}-{nonce}", std::process::id()))
    }

    async fn create_sqlx_migrations_table(pool: &SqlitePool) {
        pool.execute(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            )",
        )
        .await
        .unwrap();
    }

    #[test]
    fn legacy_roaming_cleanup_removes_known_files_and_empty_parent() {
        let root = unique_temp_root("legacy-cleanup-known");
        let legacy_dir = root.join("com.timetracker");
        let target_dir = root.join("Patina");
        std::fs::create_dir_all(legacy_dir.join("remote-backup-temp")).unwrap();
        std::fs::create_dir_all(&target_dir).unwrap();
        std::fs::write(legacy_dir.join("timetracker.db"), b"legacy").unwrap();
        std::fs::write(legacy_dir.join("timetracker.db-wal"), b"wal").unwrap();
        std::fs::write(legacy_dir.join("timetracker.db-shm"), b"shm").unwrap();
        std::fs::write(
            legacy_dir.join("remote-backup-temp").join("temp.zip"),
            b"temp",
        )
        .unwrap();

        let outcome = cleanup_legacy_roaming_data_dir(&legacy_dir, &target_dir).unwrap();

        assert_eq!(outcome, LegacyCleanupOutcome::RemovedLegacyDir);
        assert!(!legacy_dir.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn legacy_roaming_cleanup_preserves_unknown_files() {
        let root = unique_temp_root("legacy-cleanup-unknown");
        let legacy_dir = root.join("com.timetracker");
        let target_dir = root.join("Patina");
        std::fs::create_dir_all(&legacy_dir).unwrap();
        std::fs::create_dir_all(&target_dir).unwrap();
        std::fs::write(legacy_dir.join("timetracker.db"), b"legacy").unwrap();
        std::fs::write(legacy_dir.join("notes.txt"), b"keep").unwrap();

        let outcome = cleanup_legacy_roaming_data_dir(&legacy_dir, &target_dir).unwrap();

        assert_eq!(outcome, LegacyCleanupOutcome::KeptUnknownFiles);
        assert!(legacy_dir.exists());
        assert!(!legacy_dir.join("timetracker.db").exists());
        assert_eq!(
            std::fs::read(legacy_dir.join("notes.txt")).unwrap(),
            b"keep"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn legacy_roaming_cleanup_moves_backups_without_overwriting_current_files() {
        let root = unique_temp_root("legacy-cleanup-backups");
        let legacy_dir = root.join("com.timetracker");
        let target_dir = root.join("Patina");
        let legacy_backup_dir = legacy_dir.join("backups");
        let target_backup_dir = target_dir.join("backups");
        std::fs::create_dir_all(&legacy_backup_dir).unwrap();
        std::fs::create_dir_all(&target_backup_dir).unwrap();
        std::fs::write(legacy_backup_dir.join("same.zip"), b"legacy").unwrap();
        std::fs::write(legacy_backup_dir.join("only-legacy.zip"), b"move").unwrap();
        std::fs::write(target_backup_dir.join("same.zip"), b"current").unwrap();

        let outcome = cleanup_legacy_roaming_data_dir(&legacy_dir, &target_dir).unwrap();

        assert_eq!(outcome, LegacyCleanupOutcome::KeptUnknownFiles);
        assert_eq!(
            std::fs::read(target_backup_dir.join("same.zip")).unwrap(),
            b"current"
        );
        assert_eq!(
            std::fs::read(target_backup_dir.join("only-legacy.zip")).unwrap(),
            b"move"
        );
        assert_eq!(
            std::fs::read(legacy_backup_dir.join("same.zip")).unwrap(),
            b"legacy"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn webview_cache_cleanup_removes_empty_pre_release_root() {
        let root = unique_temp_root("webview-cleanup-empty-root");
        let webview_root = root.join("Patina").join("WebView");
        std::fs::create_dir_all(webview_root.join("EBWebView")).unwrap();

        remove_dir_all_if_exists(
            &webview_root.join("EBWebView"),
            "obsolete pre-release WebView data dir",
        )
        .unwrap();
        remove_empty_dir_if_exists(&webview_root, "obsolete pre-release WebView root").unwrap();

        assert!(!webview_root.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn webview_cache_cleanup_preserves_unknown_pre_release_files() {
        let root = unique_temp_root("webview-cleanup-unknown");
        let webview_root = root.join("Patina").join("WebView");
        std::fs::create_dir_all(webview_root.join("EBWebView")).unwrap();
        std::fs::write(webview_root.join("notes.txt"), b"keep").unwrap();

        remove_dir_all_if_exists(
            &webview_root.join("EBWebView"),
            "obsolete pre-release WebView data dir",
        )
        .unwrap();
        remove_empty_dir_if_exists(&webview_root, "obsolete pre-release WebView root").unwrap();

        assert!(webview_root.exists());
        assert!(!webview_root.join("EBWebView").exists());
        assert_eq!(
            std::fs::read(webview_root.join("notes.txt")).unwrap(),
            b"keep"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn current_baseline_migration_creates_complete_schema() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();

            assert!(has_current_baseline_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn tools_schema_creates_complete_tool_tables() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();

            assert!(has_base_tools_schema(&pool).await.unwrap());
            assert!(!has_software_reminder_rules_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn software_reminder_schema_creates_rule_table() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
                .await
                .unwrap();

            assert!(has_software_reminder_rules_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn current_schema_history_is_normalized_to_single_baseline_row() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            create_sqlx_migrations_table(&pool).await;
            pool.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (1, 'old_v1', 1, x'01', 0),
                        (2, 'old_v2', 1, x'02', 0),
                        (7, 'old_v7', 1, x'07', 0)",
            )
            .await
            .unwrap();

            let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap();

            assert!(normalized);
            let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
                .fetch_all(&pool)
                .await
                .unwrap();
            let expected = expected_migration_metadata();

            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].get::<i64, _>("version"), expected[0].0);
            assert_eq!(rows[0].get::<String, _>("description"), expected[0].1);
            assert_eq!(rows[0].get::<Vec<u8>, _>("checksum"), expected[0].2);
        });
    }

    #[test]
    fn current_schema_history_preserves_tools_schema_row() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
            create_sqlx_migrations_table(&pool).await;
            pool.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (1, 'old_v1', 1, x'01', 0),
                        (2, 'old_v2', 1, x'02', 0)",
            )
            .await
            .unwrap();

            let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap();

            assert!(normalized);
            let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
                .fetch_all(&pool)
                .await
                .unwrap();
            let mut expected = expected_migration_metadata();
            expected.truncate(2);

            assert_eq!(rows.len(), expected.len());
            for (version, description, checksum) in expected {
                assert!(rows.iter().any(|row| {
                    row.get::<i64, _>("version") == version
                        && row.get::<String, _>("description") == description
                        && row.get::<Vec<u8>, _>("checksum") == checksum
                }));
            }
        });
    }

    #[test]
    fn current_schema_history_preserves_software_reminder_schema_row() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
            pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
                .await
                .unwrap();
            create_sqlx_migrations_table(&pool).await;
            pool.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (1, 'old_v1', 1, x'01', 0),
                        (2, 'old_v2', 1, x'02', 0),
                        (3, 'old_v3', 1, x'03', 0)",
            )
            .await
            .unwrap();

            let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap();

            assert!(normalized);
            let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
                .fetch_all(&pool)
                .await
                .unwrap();
            let expected = expected_migration_metadata();

            assert_eq!(rows.len(), expected.len());
            for (version, description, checksum) in expected {
                assert!(rows.iter().any(|row| {
                    row.get::<i64, _>("version") == version
                        && row.get::<String, _>("description") == description
                        && row.get::<Vec<u8>, _>("checksum") == checksum
                }));
            }
        });
    }

    async fn create_legacy_schema_without_continuity_column(pool: &SqlitePool) {
        pool.execute(
            "CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_name TEXT NOT NULL,
                exe_name TEXT NOT NULL,
                window_title TEXT,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                duration INTEGER
            );
            CREATE INDEX idx_sessions_date ON sessions(start_time);
            CREATE UNIQUE INDEX idx_sessions_single_active ON sessions((1)) WHERE end_time IS NULL;
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE icon_cache (
                exe_name TEXT PRIMARY KEY,
                icon_base64 TEXT NOT NULL,
                last_updated INTEGER
            );",
        )
        .await
        .unwrap();
    }

    #[test]
    fn legacy_schema_without_continuity_column_is_repaired() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            create_legacy_schema_without_continuity_column(&pool).await;

            let repaired = repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap();

            assert!(repaired);
            assert!(sessions_has_column(&pool, "continuity_group_start_time")
                .await
                .unwrap());
            assert!(has_current_baseline_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn legacy_schema_repair_preserves_existing_sessions() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            create_legacy_schema_without_continuity_column(&pool).await;
            pool.execute(
                "INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration)
                 VALUES ('Editor', 'editor.exe', 'Doc', 100, 150, 50),
                        ('Browser', 'browser.exe', 'Page', 200, NULL, NULL)",
            )
            .await
            .unwrap();

            repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap();

            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 2);
        });
    }

    #[test]
    fn legacy_schema_repair_backfills_continuity_group_start_time() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            create_legacy_schema_without_continuity_column(&pool).await;
            pool.execute(
                "INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration)
                 VALUES ('Editor', 'editor.exe', 'Doc', 321, 654, 333)",
            )
            .await
            .unwrap();

            repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap();

            let continuity_group_start_time: i64 =
                sqlx::query_scalar("SELECT continuity_group_start_time FROM sessions")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(continuity_group_start_time, 321);
        });
    }

    #[test]
    fn legacy_schema_repair_then_normalizes_migration_history() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            create_legacy_schema_without_continuity_column(&pool).await;
            create_sqlx_migrations_table(&pool).await;
            pool.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (1, 'old_v1', 1, x'01', 0)",
            )
                .await
                .unwrap();

            repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap();
            let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap();

            assert!(normalized);
            let description: String =
                sqlx::query_scalar("SELECT description FROM _sqlx_migrations WHERE version = 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(description, schema::CURRENT_BASELINE_MIGRATION_DESCRIPTION);
        });
    }

    #[test]
    fn legacy_schema_repair_dedupes_active_sessions() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(
                "CREATE TABLE sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_name TEXT NOT NULL,
                    exe_name TEXT NOT NULL,
                    window_title TEXT,
                    start_time INTEGER NOT NULL,
                    end_time INTEGER,
                    duration INTEGER
                );
                CREATE INDEX idx_sessions_date ON sessions(start_time);
                CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE icon_cache (
                    exe_name TEXT PRIMARY KEY,
                    icon_base64 TEXT NOT NULL,
                    last_updated INTEGER
                );
                INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration)
                VALUES ('A', 'a.exe', 'A', 100, NULL, NULL),
                       ('B', 'b.exe', 'B', 200, NULL, NULL);",
            )
            .await
            .unwrap();

            repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap();

            let active_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let sealed_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE duration = 0")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(active_count, 1);
            assert_eq!(sealed_count, 1);
            assert!(sessions_has_index(&pool, "idx_sessions_single_active")
                .await
                .unwrap());
        });
    }

    #[test]
    fn current_baseline_includes_title_samples_table_and_indexes() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();

            assert!(table_exists(&pool, "session_title_samples").await.unwrap());
            assert!(table_has_index(
                &pool,
                "session_title_samples",
                "idx_session_title_samples_session_time",
            )
            .await
            .unwrap());
            assert!(table_has_index(
                &pool,
                "session_title_samples",
                "idx_session_title_samples_time",
            )
            .await
            .unwrap());
            assert!(has_current_baseline_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn legacy_schema_repair_creates_title_samples_and_backfills_once() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            create_legacy_schema_without_continuity_column(&pool).await;
            pool.execute(
                "INSERT INTO sessions (id, app_name, exe_name, window_title, start_time, end_time, duration)
                 VALUES (1, 'Editor', 'editor.exe', 'Doc', 100, 150, 50),
                        (2, 'Browser', 'browser.exe', '', 200, 250, 50)",
            )
            .await
            .unwrap();

            assert!(repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap());
            assert!(!repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap());

            let samples: Vec<(i64, String, i64, Option<i64>)> = sqlx::query_as(
                "SELECT session_id, title, start_time, end_time
                 FROM session_title_samples
                 ORDER BY id ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(samples, vec![(1, "Doc".to_string(), 100, Some(150))]);
            assert!(has_current_baseline_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn current_schema_repair_is_idempotent() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();

            assert!(!repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap());
            assert!(has_current_baseline_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn incomplete_schema_is_not_marked_as_current_baseline() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(
                "CREATE TABLE sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_name TEXT NOT NULL,
                    exe_name TEXT NOT NULL,
                    window_title TEXT,
                    start_time INTEGER NOT NULL,
                    end_time INTEGER,
                    duration INTEGER
                );",
            )
            .await
            .unwrap();
            create_sqlx_migrations_table(&pool).await;
            pool.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (1, 'old_v1', 1, x'01', 0)",
            )
            .await
            .unwrap();

            repair_legacy_schema_before_baseline_normalization(&pool)
                .await
                .unwrap();
            let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap();

            assert!(!normalized);
            let description: String =
                sqlx::query_scalar("SELECT description FROM _sqlx_migrations WHERE version = 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(description, "old_v1");
        });
    }
}
