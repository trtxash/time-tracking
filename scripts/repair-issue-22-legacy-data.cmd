@echo off
setlocal

set "SCRIPT_PATH=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$path=$env:SCRIPT_PATH; $raw=[System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8); $marker='### POWERSHELL_PAYLOAD ###'; $index=$raw.LastIndexOf($marker); if ($index -lt 0) { Write-Host 'Embedded repair payload was not found.' -ForegroundColor Red; exit 1 }; $payload=$raw.Substring($index + $marker.Length); Invoke-Expression $payload"
set EXIT_CODE=%ERRORLEVEL%

echo.
if not "%EXIT_CODE%"=="0" (
  echo Repair did not complete. See the message above.
) else (
  echo Repair completed. Start Patina again to check the history data.
)
pause
exit /b %EXIT_CODE%

### POWERSHELL_PAYLOAD ###

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$legacyDbName = "timetracker.db"
$patinaDbName = "patina.db"
$dbSuffixes = @("", "-wal", "-shm")

function Stop-WithMessage {
  param([string]$Message)

  Write-Host ""
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

function Write-Step {
  param([string]$Message)

  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Get-ExistingDbFiles {
  param(
    [string]$Directory,
    [string]$BaseName
  )

  $files = @()
  foreach ($suffix in $dbSuffixes) {
    $path = Join-Path $Directory "$BaseName$suffix"
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $files += Get-Item -LiteralPath $path
    }
  }
  return $files
}

function Get-TotalLength {
  param([object[]]$Files)

  $total = 0L
  foreach ($file in $Files) {
    $total += [int64]$file.Length
  }
  return $total
}

function Copy-FilesToBackup {
  param(
    [object[]]$Files,
    [string]$BackupDir
  )

  if ($Files.Count -eq 0) {
    return
  }

  Ensure-Directory $BackupDir
  foreach ($file in $Files) {
    $target = Join-Path $BackupDir $file.Name
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    Write-Host "Backup: $($file.FullName) -> $target"
  }
}

function Copy-DirectoryContentsToBackup {
  param(
    [string]$SourceDir,
    [string]$BackupDir
  )

  if (-not (Test-Path -LiteralPath $SourceDir -PathType Container)) {
    return
  }

  Ensure-Directory $BackupDir
  $entries = Get-ChildItem -LiteralPath $SourceDir -Force
  foreach ($entry in $entries) {
    $target = Join-Path $BackupDir $entry.Name
    Copy-Item -LiteralPath $entry.FullName -Destination $target -Recurse -Force
    Write-Host "Backup legacy item: $($entry.FullName) -> $target"
  }
}

function Move-CurrentPatinaFilesToBackup {
  param(
    [object[]]$Files,
    [string]$BackupDir
  )

  if ($Files.Count -eq 0) {
    return
  }

  Ensure-Directory $BackupDir
  foreach ($file in $Files) {
    $target = Join-Path $BackupDir $file.Name
    Move-Item -LiteralPath $file.FullName -Destination $target -Force
    Write-Host "Move current Patina DB aside: $($file.FullName) -> $target"
  }
}

function Remove-LegacyDataDirectory {
  param([string]$LegacyDir)

  if (-not (Test-Path -LiteralPath $LegacyDir -PathType Container)) {
    return
  }

  $legacyFullPath = [System.IO.Path]::GetFullPath($LegacyDir)
  $appDataFullPath = [System.IO.Path]::GetFullPath($env:APPDATA)
  $appDataPrefix = $appDataFullPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  $legacyLeafName = Split-Path -Leaf $legacyFullPath

  if ($legacyLeafName -ne "com.timetracker") {
    Stop-WithMessage "Refusing to remove unexpected legacy directory: $legacyFullPath"
  }

  if (-not $legacyFullPath.StartsWith($appDataPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-WithMessage "Refusing to remove a directory outside APPDATA: $legacyFullPath"
  }

  Remove-Item -LiteralPath $legacyFullPath -Recurse -Force
  Write-Host "Removed legacy data directory: $legacyFullPath"
}

function Copy-LegacyDbToStaging {
  param(
    [string]$LegacyDir,
    [string]$StagingDir
  )

  Ensure-Directory $StagingDir
  foreach ($suffix in $dbSuffixes) {
    $source = Join-Path $LegacyDir "$legacyDbName$suffix"
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      continue
    }

    $target = Join-Path $StagingDir "$patinaDbName$suffix"
    Copy-Item -LiteralPath $source -Destination $target -Force
    Write-Host "Stage legacy DB file: $source -> $target"
  }
}

function Move-StagedDbToPatina {
  param(
    [string]$StagingDir,
    [string]$PatinaDir
  )

  foreach ($suffix in $dbSuffixes) {
    $source = Join-Path $StagingDir "$patinaDbName$suffix"
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      continue
    }

    $target = Join-Path $PatinaDir "$patinaDbName$suffix"
    Move-Item -LiteralPath $source -Destination $target -Force
    Write-Host "Install migrated DB file: $source -> $target"
  }
}

function Copy-LegacyBackupsWithoutOverwrite {
  param(
    [string]$LegacyDir,
    [string]$PatinaDir
  )

  $legacyBackupDir = Join-Path $LegacyDir "backups"
  if (-not (Test-Path -LiteralPath $legacyBackupDir -PathType Container)) {
    return
  }

  $targetBackupDir = Join-Path $PatinaDir "backups"
  Ensure-Directory $targetBackupDir

  $entries = Get-ChildItem -LiteralPath $legacyBackupDir -File
  foreach ($entry in $entries) {
    $target = Join-Path $targetBackupDir $entry.Name
    if (Test-Path -LiteralPath $target) {
      Write-Host "Keep existing backup, skip legacy file: $target"
      continue
    }

    Copy-Item -LiteralPath $entry.FullName -Destination $target
    Write-Host "Copy legacy backup: $($entry.FullName) -> $target"
  }
}

function Write-MigrationMarker {
  param(
    [string]$MarkerPath,
    [string]$LegacyDir,
    [string]$PatinaDir,
    [string]$BackupDir,
    [bool]$ReplacedCurrentDb
  )

  $marker = [ordered]@{
    reason = "issue-22-legacy-data-repair"
    migratedAt = (Get-Date).ToString("o")
    legacyDataDir = $LegacyDir
    patinaDataDir = $PatinaDir
    backupDir = $BackupDir
    replacedCurrentPatinaDb = $ReplacedCurrentDb
  }

  $json = $marker | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($MarkerPath, $json, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Write marker: $MarkerPath"
}

function Assert-AppNotRunning {
  $knownProcessNames = @("Patina", "patina", "time_tracker", "TimeTracker")
  $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $knownProcessNames -contains $_.ProcessName
  })

  if ($running.Count -eq 0) {
    return
  }

  $names = ($running | Select-Object -ExpandProperty ProcessName -Unique) -join ", "
  Stop-WithMessage "Close Patina/Time Tracker before running this script. Running processes: $names"
}

function Ensure-SqliteInterop {
  if ("PatinaIssue22SQLite" -as [type]) {
    return
  }

  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class PatinaIssue22SQLite
{
    const int SQLITE_OK = 0;
    const int SQLITE_ROW = 100;
    const int SQLITE_DONE = 101;
    const int SQLITE_OPEN_READWRITE = 0x00000002;
    const int SQLITE_OPEN_CREATE = 0x00000004;

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl, EntryPoint = "sqlite3_open_v2")]
    static extern int sqlite3_open_v2(byte[] filename, out IntPtr db, int flags, IntPtr vfs);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl, EntryPoint = "sqlite3_close")]
    static extern int sqlite3_close(IntPtr db);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl, EntryPoint = "sqlite3_exec")]
    static extern int sqlite3_exec(IntPtr db, byte[] sql, IntPtr callback, IntPtr arg, out IntPtr errmsg);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl, EntryPoint = "sqlite3_free")]
    static extern void sqlite3_free(IntPtr ptr);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl, EntryPoint = "sqlite3_errmsg")]
    static extern IntPtr sqlite3_errmsg(IntPtr db);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl, EntryPoint = "sqlite3_prepare_v2")]
    static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int nByte, out IntPtr stmt, IntPtr tail);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl, EntryPoint = "sqlite3_step")]
    static extern int sqlite3_step(IntPtr stmt);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl, EntryPoint = "sqlite3_finalize")]
    static extern int sqlite3_finalize(IntPtr stmt);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl, EntryPoint = "sqlite3_column_int64")]
    static extern long sqlite3_column_int64(IntPtr stmt, int column);

    [DllImport("winsqlite3", CallingConvention = CallingConvention.Cdecl, EntryPoint = "sqlite3_bind_text")]
    static extern int sqlite3_bind_text(IntPtr stmt, int index, byte[] value, int byteCount, IntPtr destructor);

    static byte[] Utf8Zero(string value)
    {
        return Encoding.UTF8.GetBytes(value + "\0");
    }

    static string PtrToUtf8String(IntPtr ptr)
    {
        if (ptr == IntPtr.Zero)
        {
            return "";
        }

        int length = 0;
        while (Marshal.ReadByte(ptr, length) != 0)
        {
            length++;
        }

        byte[] bytes = new byte[length];
        Marshal.Copy(ptr, bytes, 0, length);
        return Encoding.UTF8.GetString(bytes);
    }

    static string ErrorMessage(IntPtr db)
    {
        return PtrToUtf8String(sqlite3_errmsg(db));
    }

    public static IntPtr OpenReadWrite(string path)
    {
        IntPtr db;
        int rc = sqlite3_open_v2(Utf8Zero(path), out db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, IntPtr.Zero);
        if (rc != SQLITE_OK)
        {
            string message = db == IntPtr.Zero ? "failed to open sqlite database" : ErrorMessage(db);
            if (db != IntPtr.Zero)
            {
                sqlite3_close(db);
            }
            throw new Exception(message);
        }
        return db;
    }

    public static void Close(IntPtr db)
    {
        if (db != IntPtr.Zero)
        {
            sqlite3_close(db);
        }
    }

    public static void Execute(IntPtr db, string sql)
    {
        IntPtr error;
        int rc = sqlite3_exec(db, Utf8Zero(sql), IntPtr.Zero, IntPtr.Zero, out error);
        if (rc != SQLITE_OK)
        {
            string message = error == IntPtr.Zero ? ErrorMessage(db) : PtrToUtf8String(error);
            if (error != IntPtr.Zero)
            {
                sqlite3_free(error);
            }
            throw new Exception(message);
        }
    }

    public static void ExecuteTextParam(IntPtr db, string sql, string value)
    {
        IntPtr stmt = IntPtr.Zero;
        int rc = sqlite3_prepare_v2(db, Utf8Zero(sql), -1, out stmt, IntPtr.Zero);
        if (rc != SQLITE_OK)
        {
            throw new Exception(ErrorMessage(db));
        }

        try
        {
            byte[] bytes = Encoding.UTF8.GetBytes(value);
            rc = sqlite3_bind_text(stmt, 1, bytes, bytes.Length, new IntPtr(-1));
            if (rc != SQLITE_OK)
            {
                throw new Exception(ErrorMessage(db));
            }

            rc = sqlite3_step(stmt);
            if (rc != SQLITE_DONE)
            {
                throw new Exception(ErrorMessage(db));
            }
        }
        finally
        {
            sqlite3_finalize(stmt);
        }
    }

    public static long ScalarLong(IntPtr db, string sql)
    {
        IntPtr stmt = IntPtr.Zero;
        int rc = sqlite3_prepare_v2(db, Utf8Zero(sql), -1, out stmt, IntPtr.Zero);
        if (rc != SQLITE_OK)
        {
            throw new Exception(ErrorMessage(db));
        }

        try
        {
            rc = sqlite3_step(stmt);
            if (rc == SQLITE_ROW)
            {
                return sqlite3_column_int64(stmt, 0);
            }
            if (rc == SQLITE_DONE)
            {
                return 0;
            }
            throw new Exception(ErrorMessage(db));
        }
        finally
        {
            sqlite3_finalize(stmt);
        }
    }
}
"@
}

function Invoke-SqliteExecute {
  param(
    [IntPtr]$Db,
    [string]$Sql
  )

  [PatinaIssue22SQLite]::Execute($Db, $Sql)
}

function Test-SqliteTable {
  param(
    [IntPtr]$Db,
    [string]$SchemaName,
    [string]$TableName
  )

  $sql = "SELECT COUNT(*) FROM $SchemaName.sqlite_master WHERE type = 'table' AND name = '$TableName'"
  return ([PatinaIssue22SQLite]::ScalarLong($Db, $sql) -gt 0)
}

function Ensure-PatinaSchema {
  param([IntPtr]$Db)

  Invoke-SqliteExecute $Db @"
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_name TEXT NOT NULL,
  exe_name TEXT NOT NULL,
  window_title TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration INTEGER,
  continuity_group_start_time INTEGER
);
CREATE TABLE IF NOT EXISTS session_title_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
UPDATE sessions
SET end_time = start_time,
    duration = 0
WHERE end_time IS NULL
  AND id NOT IN (
    SELECT id
    FROM sessions
    WHERE end_time IS NULL
    ORDER BY start_time DESC, id DESC
    LIMIT 1
  );
UPDATE sessions
SET continuity_group_start_time = start_time
WHERE continuity_group_start_time IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(start_time);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_single_active ON sessions((1)) WHERE end_time IS NULL;
CREATE INDEX IF NOT EXISTS idx_session_title_samples_session_time ON session_title_samples(session_id, start_time);
CREATE INDEX IF NOT EXISTS idx_session_title_samples_time ON session_title_samples(start_time, end_time);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS icon_cache (
  exe_name TEXT PRIMARY KEY,
  icon_base64 TEXT NOT NULL,
  last_updated INTEGER
);
CREATE TABLE IF NOT EXISTS tool_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  fired_at INTEGER,
  cancelled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tool_reminders_schedule_status ON tool_reminders(status, scheduled_at);
CREATE TABLE IF NOT EXISTS tool_timers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  label TEXT,
  duration_ms INTEGER,
  accumulated_ms INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  paused_at INTEGER,
  completed_at INTEGER,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_timers_status_updated ON tool_timers(status, updated_at);
CREATE TABLE IF NOT EXISTS tool_timer_laps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timer_id INTEGER NOT NULL,
  lap_index INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  FOREIGN KEY(timer_id) REFERENCES tool_timers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tool_timer_laps_timer_id ON tool_timer_laps(timer_id, lap_index);
CREATE TABLE IF NOT EXISTS tool_pomodoro_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  cycle_index INTEGER NOT NULL,
  focus_ms INTEGER NOT NULL,
  short_break_ms INTEGER NOT NULL,
  long_break_ms INTEGER NOT NULL,
  long_break_every INTEGER NOT NULL,
  phase_started_at INTEGER,
  phase_paused_at INTEGER,
  phase_remaining_ms INTEGER,
  completed_focus_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_pomodoro_runs_status_updated ON tool_pomodoro_runs(status, updated_at);
CREATE TABLE IF NOT EXISTS tool_daily_stats (
  date_key TEXT PRIMARY KEY,
  completed_pomodoros INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_daily_stats_updated ON tool_daily_stats(updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_app_usage_time ON sessions(app_name COLLATE NOCASE, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_sessions_exe_usage_time ON sessions(exe_name COLLATE NOCASE, start_time, end_time);
CREATE TABLE IF NOT EXISTS tool_software_reminder_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_name TEXT NOT NULL,
  exe_name TEXT,
  limit_ms INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  disabled_at INTEGER,
  last_fired_date_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_tool_software_reminder_rules_active ON tool_software_reminder_rules(disabled_at, app_name, exe_name);
"@
}

function Invoke-OptionalMergeSql {
  param(
    [IntPtr]$Db,
    [string[]]$RequiredCurrentTables,
    [string]$Sql
  )

  foreach ($tableName in $RequiredCurrentTables) {
    if (-not (Test-SqliteTable -Db $Db -SchemaName "current_db" -TableName $tableName)) {
      Write-Host "Skip merge for missing current table: $tableName"
      return
    }
  }

  Invoke-SqliteExecute $Db $Sql
}

function Merge-CurrentPatinaDatabase {
  param(
    [string]$StagingDbPath,
    [string]$CurrentDbPath
  )

  if (-not (Test-Path -LiteralPath $CurrentDbPath -PathType Leaf)) {
    Write-Host "No current Patina database to merge."
    return
  }

  Ensure-SqliteInterop
  $db = [PatinaIssue22SQLite]::OpenReadWrite($StagingDbPath)
  $committed = $false

  try {
    Invoke-SqliteExecute $db "PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF;"
    [PatinaIssue22SQLite]::ExecuteTextParam($db, "ATTACH DATABASE ? AS current_db", $CurrentDbPath)

    Ensure-PatinaSchema $db

    $currentSessionCount = 0
    if (Test-SqliteTable -Db $db -SchemaName "current_db" -TableName "sessions") {
      $currentSessionCount = [PatinaIssue22SQLite]::ScalarLong($db, "SELECT COUNT(*) FROM current_db.sessions")
    }

    if ($currentSessionCount -eq 0) {
      Write-Host "Current Patina database has no sessions to merge."
    } else {
      Write-Host "Merging current Patina database rows into the legacy database copy..."
    }

    Invoke-SqliteExecute $db "BEGIN IMMEDIATE;"
    try {
      Invoke-OptionalMergeSql $db @("sessions") @"
DROP TABLE IF EXISTS temp.issue22_session_candidates;
CREATE TEMP TABLE issue22_session_candidates AS
SELECT c.*
FROM current_db.sessions c
WHERE c.end_time IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM sessions t
    WHERE t.app_name = c.app_name
      AND t.exe_name = c.exe_name
      AND IFNULL(t.window_title, '') = IFNULL(c.window_title, '')
      AND t.start_time = c.start_time
      AND IFNULL(t.end_time, -9223372036854775808) = IFNULL(c.end_time, -9223372036854775808)
      AND IFNULL(t.duration, -9223372036854775808) = IFNULL(c.duration, -9223372036854775808)
  );
INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration, continuity_group_start_time)
SELECT app_name, exe_name, window_title, start_time, end_time, duration, continuity_group_start_time
FROM issue22_session_candidates;
DROP TABLE IF EXISTS temp.issue22_session_id_map;
CREATE TEMP TABLE issue22_session_id_map AS
SELECT c.id AS old_id, t.id AS new_id
FROM current_db.sessions c
JOIN sessions t
  ON t.app_name = c.app_name
 AND t.exe_name = c.exe_name
 AND IFNULL(t.window_title, '') = IFNULL(c.window_title, '')
 AND t.start_time = c.start_time
 AND IFNULL(t.end_time, -9223372036854775808) = IFNULL(c.end_time, -9223372036854775808)
 AND IFNULL(t.duration, -9223372036854775808) = IFNULL(c.duration, -9223372036854775808);
"@

      Invoke-OptionalMergeSql $db @("session_title_samples", "sessions") @"
INSERT INTO session_title_samples (session_id, title, start_time, end_time)
SELECT m.new_id, s.title, s.start_time, s.end_time
FROM current_db.session_title_samples s
JOIN temp.issue22_session_id_map m ON m.old_id = s.session_id
WHERE NOT EXISTS (
  SELECT 1
  FROM session_title_samples existing
  WHERE existing.session_id = m.new_id
    AND existing.title = s.title
    AND existing.start_time = s.start_time
    AND IFNULL(existing.end_time, -9223372036854775808) = IFNULL(s.end_time, -9223372036854775808)
);
"@

      Invoke-OptionalMergeSql $db @("settings") "INSERT OR IGNORE INTO settings (key, value) SELECT key, value FROM current_db.settings;"
      Invoke-OptionalMergeSql $db @("icon_cache") "INSERT OR IGNORE INTO icon_cache (exe_name, icon_base64, last_updated) SELECT exe_name, icon_base64, last_updated FROM current_db.icon_cache;"

      Invoke-OptionalMergeSql $db @("tool_reminders") @"
INSERT INTO tool_reminders (label, scheduled_at, created_at, status, fired_at, cancelled_at)
SELECT c.label, c.scheduled_at, c.created_at, c.status, c.fired_at, c.cancelled_at
FROM current_db.tool_reminders c
WHERE NOT EXISTS (
  SELECT 1
  FROM tool_reminders t
  WHERE t.label = c.label
    AND t.scheduled_at = c.scheduled_at
    AND t.created_at = c.created_at
    AND t.status = c.status
);
"@

      Invoke-OptionalMergeSql $db @("tool_timers") @"
DROP TABLE IF EXISTS temp.issue22_timer_candidates;
CREATE TEMP TABLE issue22_timer_candidates AS
SELECT c.*
FROM current_db.tool_timers c
WHERE NOT EXISTS (
  SELECT 1
  FROM tool_timers t
  WHERE t.mode = c.mode
    AND IFNULL(t.label, '') = IFNULL(c.label, '')
    AND IFNULL(t.duration_ms, -9223372036854775808) = IFNULL(c.duration_ms, -9223372036854775808)
    AND t.created_at = c.created_at
    AND t.updated_at = c.updated_at
);
INSERT INTO tool_timers (mode, label, duration_ms, accumulated_ms, started_at, paused_at, completed_at, status, created_at, updated_at)
SELECT mode, label, duration_ms, accumulated_ms, started_at, paused_at, completed_at, status, created_at, updated_at
FROM issue22_timer_candidates;
DROP TABLE IF EXISTS temp.issue22_timer_id_map;
CREATE TEMP TABLE issue22_timer_id_map AS
SELECT c.id AS old_id, t.id AS new_id
FROM current_db.tool_timers c
JOIN tool_timers t
  ON t.mode = c.mode
 AND IFNULL(t.label, '') = IFNULL(c.label, '')
 AND IFNULL(t.duration_ms, -9223372036854775808) = IFNULL(c.duration_ms, -9223372036854775808)
 AND t.created_at = c.created_at
 AND t.updated_at = c.updated_at;
"@

      Invoke-OptionalMergeSql $db @("tool_timer_laps", "tool_timers") @"
INSERT INTO tool_timer_laps (timer_id, lap_index, started_at, ended_at, duration_ms)
SELECT m.new_id, lap.lap_index, lap.started_at, lap.ended_at, lap.duration_ms
FROM current_db.tool_timer_laps lap
JOIN temp.issue22_timer_id_map m ON m.old_id = lap.timer_id
WHERE NOT EXISTS (
  SELECT 1
  FROM tool_timer_laps existing
  WHERE existing.timer_id = m.new_id
    AND existing.lap_index = lap.lap_index
    AND existing.started_at = lap.started_at
    AND existing.ended_at = lap.ended_at
);
"@

      Invoke-OptionalMergeSql $db @("tool_pomodoro_runs") @"
INSERT INTO tool_pomodoro_runs (
  phase, status, cycle_index, focus_ms, short_break_ms, long_break_ms, long_break_every,
  phase_started_at, phase_paused_at, phase_remaining_ms, completed_focus_count, created_at, updated_at
)
SELECT
  c.phase, c.status, c.cycle_index, c.focus_ms, c.short_break_ms, c.long_break_ms, c.long_break_every,
  c.phase_started_at, c.phase_paused_at, c.phase_remaining_ms, c.completed_focus_count, c.created_at, c.updated_at
FROM current_db.tool_pomodoro_runs c
WHERE NOT EXISTS (
  SELECT 1
  FROM tool_pomodoro_runs t
  WHERE t.phase = c.phase
    AND t.status = c.status
    AND t.cycle_index = c.cycle_index
    AND t.created_at = c.created_at
    AND t.updated_at = c.updated_at
);
"@

      Invoke-OptionalMergeSql $db @("tool_daily_stats") @"
INSERT INTO tool_daily_stats (date_key, completed_pomodoros, updated_at)
SELECT date_key, completed_pomodoros, updated_at
FROM current_db.tool_daily_stats
ON CONFLICT(date_key) DO UPDATE SET
  completed_pomodoros = MAX(tool_daily_stats.completed_pomodoros, excluded.completed_pomodoros),
  updated_at = MAX(tool_daily_stats.updated_at, excluded.updated_at);
"@

      Invoke-OptionalMergeSql $db @("tool_software_reminder_rules") @"
INSERT INTO tool_software_reminder_rules (app_name, exe_name, limit_ms, message, created_at, updated_at, disabled_at, last_fired_date_key)
SELECT c.app_name, c.exe_name, c.limit_ms, c.message, c.created_at, c.updated_at, c.disabled_at, c.last_fired_date_key
FROM current_db.tool_software_reminder_rules c
WHERE NOT EXISTS (
  SELECT 1
  FROM tool_software_reminder_rules t
  WHERE t.app_name = c.app_name
    AND IFNULL(t.exe_name, '') = IFNULL(c.exe_name, '')
    AND t.limit_ms = c.limit_ms
    AND t.message = c.message
    AND t.created_at = c.created_at
);
"@

      Invoke-SqliteExecute $db "COMMIT;"
      $committed = $true
    } catch {
      if (-not $committed) {
        try {
          Invoke-SqliteExecute $db "ROLLBACK;"
        } catch {
        }
      }
      throw
    }

    Invoke-SqliteExecute $db "PRAGMA wal_checkpoint(TRUNCATE);"
    Invoke-SqliteExecute $db "DETACH DATABASE current_db;"
  } finally {
    [PatinaIssue22SQLite]::Close($db)
  }
}

if (-not $env:APPDATA) {
  Stop-WithMessage "APPDATA is not available. Run this in the affected Windows user account."
}

$legacyDataDir = Join-Path $env:APPDATA "com.timetracker"
$patinaDataDir = Join-Path $env:APPDATA "Patina"
$backupRoot = Join-Path $env:APPDATA "Patina-issue-22-backups"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $backupRoot $timestamp
$legacyBackupDir = Join-Path $backupDir "legacy-com.timetracker"
$currentBackupDir = Join-Path $backupDir "current-Patina"
$replacedBackupDir = Join-Path $backupDir "replaced-current-Patina-db"
$stagingDir = Join-Path $backupDir "staging"
$markerPath = Join-Path $patinaDataDir "issue-22-legacy-data-repair.json"
$legacyDbPath = Join-Path $legacyDataDir $legacyDbName

Write-Step "Patina issue #22 legacy data repair"
Write-Host "Legacy data dir: $legacyDataDir"
Write-Host "Patina data dir: $patinaDataDir"
Write-Host "Backup dir: $backupDir"
Write-Host ""
Write-Host "This will restore the old Time Tracker database and merge current Patina rows into it when possible."
Write-Host "Backups are created first, then the old com.timetracker folder is removed."
Write-Host ""

$confirm = Read-Host "Type MIGRATE and press Enter to continue"
if ($confirm -ne "MIGRATE") {
  Write-Host "Cancelled. No files were changed."
  exit 0
}

Assert-AppNotRunning

if (-not (Test-Path -LiteralPath $legacyDbPath -PathType Leaf)) {
  Stop-WithMessage "Legacy database was not found: $legacyDbPath"
}

$legacyFiles = @(Get-ExistingDbFiles -Directory $legacyDataDir -BaseName $legacyDbName)
$currentFiles = @(Get-ExistingDbFiles -Directory $patinaDataDir -BaseName $patinaDbName)
$legacyBytes = Get-TotalLength $legacyFiles
$currentBytes = Get-TotalLength $currentFiles

Write-Step "Detected database files"
Write-Host "Legacy files: $($legacyFiles.Count), total bytes: $legacyBytes"
foreach ($file in $legacyFiles) {
  Write-Host "  $($file.FullName) ($($file.Length) bytes)"
}
Write-Host "Current Patina files: $($currentFiles.Count), total bytes: $currentBytes"
foreach ($file in $currentFiles) {
  Write-Host "  $($file.FullName) ($($file.Length) bytes)"
}

if ($legacyBytes -le 0) {
  Stop-WithMessage "Legacy database files are empty."
}

Write-Step "Backing up data"
Ensure-Directory $backupDir
Ensure-Directory $patinaDataDir
Copy-DirectoryContentsToBackup -SourceDir $legacyDataDir -BackupDir $legacyBackupDir
Copy-FilesToBackup -Files $currentFiles -BackupDir $currentBackupDir

Write-Step "Preparing migrated database"
Copy-LegacyDbToStaging -LegacyDir $legacyDataDir -StagingDir $stagingDir

$currentDbPath = Join-Path $patinaDataDir $patinaDbName
if (Test-Path -LiteralPath $currentDbPath -PathType Leaf) {
  Write-Step "Merging current Patina rows into the migrated database copy"
  Merge-CurrentPatinaDatabase -StagingDbPath (Join-Path $stagingDir $patinaDbName) -CurrentDbPath $currentDbPath
}

if ($currentFiles.Count -gt 0) {
  Move-CurrentPatinaFilesToBackup -Files $currentFiles -BackupDir $replacedBackupDir
}

Move-StagedDbToPatina -StagingDir $stagingDir -PatinaDir $patinaDataDir
Copy-LegacyBackupsWithoutOverwrite -LegacyDir $legacyDataDir -PatinaDir $patinaDataDir
Write-MigrationMarker -MarkerPath $markerPath -LegacyDir $legacyDataDir -PatinaDir $patinaDataDir -BackupDir $backupDir -ReplacedCurrentDb ($currentFiles.Count -gt 0)
Remove-LegacyDataDirectory -LegacyDir $legacyDataDir

Write-Step "Done"
Write-Host "Start Patina again. It should now open the migrated legacy database."
Write-Host "If anything looks wrong, close Patina and restore files from:"
Write-Host "  $backupDir"
