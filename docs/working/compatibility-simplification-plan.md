# 兼容代码简并执行方案

## 口径

- 清点日期：2026-05-15。
- 清点范围：`src/`、`src-tauri/src/`、`scripts/`、`tests/`，并排除生成 schema、依赖锁文件和纯文案里的普通“历史”用词。
- 当前前提：至少存在一台已安装 Time Tracker 的其他电脑可能通过 updater 升级；因此下一版应按“过渡版本”处理，下下版才允许完全移除兼容代码。
- 当前约束：仓库工作区已有未提交改动，尤其集中在备份与设置链路；执行前应先确认这些改动是要保留、提交还是另行搁置。
- 判断规则：按 `docs/architecture.md` 与 `docs/issue-fix-boundary-guardrails.md`，兼容壳只允许转发、组合、类型兼容；无外部用户时，优先让真实 owner 直接承接主路径。

## 已完成数据保护

- [x] 已生成当前结构化备份：`C:\Users\SYBao\Downloads\TimeTracker-backup-20260515-205401.zip`
- [x] 已确认结构化备份包含：
  - [x] `manifest.json`
  - [x] `data/sessions.json`
  - [x] `data/settings.json`
  - [x] `data/icon_cache.json`
  - [x] `checksums.json`
- [x] 已复制原始 SQLite 文件组到：`C:\Users\SYBao\Downloads\TimeTracker-raw-db-20260515-205417\`
  - [x] `timetracker.db`
  - [x] `timetracker.db-wal`
  - [x] `timetracker.db-shm`
- [ ] 执行高风险阶段前，关闭正在运行的 Time Tracker，再额外复制一次原始 SQLite 文件组。
- [ ] 执行高风险阶段前，用当前应用 UI 预览或恢复演练一次结构化备份。

说明：备份时检测到 Time Tracker 正在运行，并且存在 WAL/SHM 文件；因此原始数据库备份已把三件套一起复制。结构化 `.zip` 备份是按当前 0.6.4 备份格式从数据库只读导出的，更适合作为后续恢复入口。

## 总量

按“兼容职责”而不是整文件行数估算，当前代码里有 6 类兼容代码：

| 类别 | 位置 | 规模 | 保守判断 |
| --- | --- | ---: | --- |
| Classification 转发壳 | `src/features/classification/config/*`、`src/features/classification/services/{ProcessMapper,processNormalization,categoryColorRegistry}.ts` | 6 个文件，约 12 行 | 第一批处理，低数据风险 |
| 旧分类值兼容 | `src/shared/classification/processMapper.ts` | 1 个生产文件加测试 | 第二批处理，只影响旧 override 解释 |
| 旧设置值兼容 | `src/platform/persistence/appSettingsStore.ts`、`src-tauri/src/domain/settings.rs` | 2 个生产文件加测试 | 第三批处理，先确认当前设置无旧值 |
| 旧备份格式兼容 | `src-tauri/src/data/backup.rs`、`src-tauri/src/domain/backup.rs`、前端 backup gateway/settings UI | 约 6 个生产文件加测试 | 有结构化备份后处理；保留安全拒绝逻辑 |
| 备份 preview 兼容字段 | Rust `BackupPreview` 与 `src/platform/backup/backupRuntimeGateway.ts` | 2 个边界文件加 UI 文案 | 可独立处理，主要是 IPC/UI 命名风险 |
| 旧 SQLite 迁移兼容 | `src-tauri/src/data/migrations.rs`、`src-tauri/src/data/sqlite_pool.rs`、`src-tauri/src/lib.rs` | 3 个生产文件，约 90 行兼容职责 | 最后处理或暂缓，唯一可能让现有 0.6.4 库打不开 |

不应计入“可删兼容债”的代码：

- `src/shared/classification/processNormalization.ts` 里的 installer/updater/tray alias 归一化：这是追踪正确性，不是旧用户兼容。
- `src/shared/lib/sessionReadCompiler.ts` 里的 alias 聚合：这是统计一致性，不是旧 API 兼容。
- Tauri/Rust/SQLite 边界的 snake_case raw DTO 映射：这是协议边界，不是遗留层。
- 备份 “version/schema 过新不可恢复” 的拒绝逻辑：这是数据安全门槛，不应因为没有用户而删除。

## 两阶段发布策略

结论：可以把下一版做成过渡版本，再在下下版完全去除兼容代码。这样既保护已有 0.6.4 安装，又能给代码收口一个明确出口。

建议版本节奏：

| 版本 | 目标 | 兼容策略 |
| --- | --- | --- |
| 下一版，例如 `0.6.5` 或 `0.7.0` | 过渡版本 | 保留旧数据读取能力，启动时把旧设置/旧分类/旧备份入口引导到当前格式；不删除 SQLite migration repair |
| 下下版，例如 `0.7.0` 或 `0.8.0` | 完全简并版本 | 在确认过渡版本已发布并使用后，删除旧格式解析、转发壳和 migration repair |

过渡版本必须满足：

- [x] 能从 0.6.4 已有 `timetracker.db` 正常启动。
- [x] 能读取旧设置值，并在保存或启动同步时写回当前格式。
- [x] 能读取旧分类 override，并在保存或启动同步时写回当前 JSON/current category 格式。
- [x] 能 preview/restore 旧备份，但新导出的备份只使用当前结构化 `.zip` 格式。
- [x] 保留 `repair_legacy_migration_history` 与 no-op migration，避免旧安装启动失败。
- [x] 在 changelog / release notes 中说明这是兼容过渡版本，并建议升级后导出一次新备份。

完全简并版本的前置条件：

- [ ] 过渡版本已经正式发布，并且另一台已安装电脑已成功升级过一次。
- [ ] 那台电脑升级后已经导出过当前结构化 `.zip` 备份。
- [ ] 已确认没有仍需恢复的旧 `.json` / `.ttbackup` / zip 内 `backup.json` 备份。
- [ ] 已确认旧设置和旧分类值已经通过过渡版本归一到当前格式。
- [ ] 再次复制原始 SQLite 文件组，作为移除 migration repair 前的最后回滚点。

## 保守执行顺序

### 0. 执行前确认

- [x] 确认当前工作区未提交改动的归属，尤其是 `src-tauri/src/data/backup.rs`、`src/platform/backup/backupRuntimeGateway.ts`、`src/features/settings/*`、`tests/settingsPageState.test.ts`。
- [ ] 确认是否接受“简并后旧设置/旧分类值不再被解释”的行为变化。
- [x] 下一版暂不动 SQLite migration repair；除非明确不通过 updater 发给任何已安装电脑。
- [x] 明确本轮非目标：不改 Quiet Pro UI 视觉方向，不新增迁移兼容壳，不引入新的 shared 临时桶。
- [ ] 建议先跑一次基线验证：`npm run check`；如果当前工作区已知不绿，记录失败项作为基线。

### 1. 删除 Classification 转发壳

目标：让调用方直接使用真实 owner：`src/shared/classification/*`。

- [x] 将 `src/app/services/processMapperRuntimeService.ts` 的 `ProcessMapper`、`AppOverride`、`AppCategory` import 改到 `src/shared/classification/*`。
- [x] 将 `src/features/classification/services/classificationStore.ts` 与 `classificationService.ts` 里通过 `./ProcessMapper.ts`、`../config/categoryTokens.ts`、`./processNormalization.ts` 的引用改到 `../../../shared/classification/*`。
- [x] 将测试里的转发壳 import 改到 `src/shared/classification/*`。
- [x] 删除 6 个纯转发文件：
  - [x] `src/features/classification/config/defaultMappings.ts`
  - [x] `src/features/classification/config/categoryTokens.ts`
  - [x] `src/features/classification/config/releaseDefaultCategoryColors.ts`
  - [x] `src/features/classification/services/ProcessMapper.ts`
  - [x] `src/features/classification/services/processNormalization.ts`
  - [x] `src/features/classification/services/categoryColorRegistry.ts`
- [x] 用 `rg "features/classification/(config|services)/(defaultMappings|categoryTokens|releaseDefaultCategoryColors|ProcessMapper|processNormalization|categoryColorRegistry)" src tests scripts` 确认没有残留。
- [x] 跑 `npm run check:architecture` 与 `npm run test:classification`。

### 2. 过渡版本：归一旧分类存储值

目标：下一版仍接受旧分类值，但只作为迁移入口；新保存结果统一写回当前 JSON 格式。

- [x] 保留 `src/shared/classification/processMapper.ts` 对旧 category 的读取：
  - [x] `meeting -> office`
  - [x] `finance -> utility`
  - [x] `reading -> browser`
  - [x] 旧 `"custom"` 字符串兜底
- [x] 增加或确认启动/保存路径会把旧 override 写回 `ProcessMapper.toOverrideStorageValue` 的 JSON 格式。
- [x] 给旧 category 解析逻辑加注释，标明“过渡版本保留，下下版删除”。
- [x] 保留现有旧 category 映射测试，并新增“保存后写回当前格式”的测试。
- [x] 跑 `npm run test:classification` 与 `npm run test:replay`。

### 2B. 完全简并版本：删除旧分类存储值兼容

目标：分类 override 只接受当前 JSON 存储格式与当前 category 集。

- [ ] 在 `src/shared/classification/processMapper.ts` 删除 `normalizeUserAssignableCategory` 中的旧 category 映射：
  - [ ] `meeting -> office`
  - [ ] `finance -> utility`
  - [ ] `reading -> browser`
  - [ ] 旧 `"custom"` 字符串兜底
- [ ] 保留当前 `custom:<name>` 格式支持，因为这是当前功能而不是旧兼容。
- [ ] 删除 `fromOverrideStorageValue` 的 `catch` 分支中“纯字符串 category”解析逻辑；解析失败直接返回 `null`。
- [ ] 更新 `tests/classificationDraftState.test.ts` 中旧 category 映射断言。
- [ ] 保留 JSON override、custom category、deleted category 的当前测试。
- [ ] 跑 `npm run test:classification` 与 `npm run test:replay`。

### 3. 过渡版本：归一旧设置值

目标：下一版仍读取旧设置值，但写回当前字段与当前枚举。

- [x] 保留 `color_scheme` fallback，但启动后或保存设置时写入 `color_scheme_light` / `color_scheme_dark`。
- [x] 保留 `minimize_behavior = tray` 读取，但将其归一为当前语义，例如 `taskbar`。
- [x] 增加或确认设置保存路径会把当前完整 settings patch 写回当前 key。
- [x] 给旧设置读取逻辑加注释，标明“过渡版本保留，下下版删除”。
- [x] 保留 `tests/settingsPageState.test.ts` 中旧设置读取测试，并新增“旧值归一后写回当前 key”的测试。
- [x] 跑 `npm run test:settings`。

### 3B. 完全简并版本：删除旧设置值兼容

目标：设置解析只支持当前字段与当前枚举。

- [ ] 在动手前检查当前数据库是否存在旧设置值：
  - [ ] `color_scheme`
  - [ ] `minimize_behavior = tray`
  - [ ] 其他已退出枚举值
- [ ] 如果存在旧值，先决定是手动迁成当前值，还是接受回落到默认值。
- [ ] 在 `src/platform/persistence/appSettingsStore.ts` 删除 `RawAppSettingsKey` 中的旧 `color_scheme`。
- [ ] 将 `colorSchemeLight` 只读取 `color_scheme_light`，将 `colorSchemeDark` 只读取 `color_scheme_dark`。
- [ ] 将 `normalizeMinimizeBehavior` 改成只接受 `"widget"` / `"taskbar"`，非法值回落到 `DEFAULT_SETTINGS.minimizeBehavior`。
- [ ] 在 `src-tauri/src/domain/settings.rs` 将 `parse_minimize_behavior` 改成只接受 `"widget"` / `"taskbar"`，非法值回落到 `MinimizeBehavior::default()`。
- [ ] 更新 `tests/settingsPageState.test.ts` 中 `minimize_behavior: "tray"` 与旧 `color_scheme` fallback 的断言。
- [ ] 更新 `src-tauri/src/domain/settings.rs` 内联测试。
- [ ] 跑 `npm run test:settings` 与 `npm run check:rust`。

### 4. 过渡版本：保留旧备份读取，只导出新格式

目标：下一版仍能恢复旧备份，但新导出的备份只使用当前结构化 `.zip`。

- [x] 保留 `.json` / `.ttbackup` / zip 内 `backup.json` 的读取能力。
- [x] 在 UI 文案或 release note 中说明旧格式只作为导入兼容存在。
- [x] 确认 `export_backup` 只输出当前结构化 `.zip`。
- [x] 保留旧备份读取测试，并新增当前 `.zip` 备份 preview/restore 测试。
- [x] 跑 `npm run test:settings`、`npm run check:rust`。

### 4B. 完全简并版本：删除旧备份格式兼容

目标：只支持当前结构化 `.zip` 备份格式，不再恢复旧 JSON / `.ttbackup` / zip 内 `backup.json`。

前置条件：

- [x] 已在 Downloads 生成结构化 `.zip` 备份。
- [ ] 已验证结构化 `.zip` 可被当前应用 preview。

执行项：

- [ ] 在 `src-tauri/src/data/backup.rs` 删除 `BACKUP_JSON_ENTRY_NAME`。
- [ ] 在 `pick_backup_file` 删除 `"Legacy backup files"` 过滤器，只保留 `.zip`。
- [ ] 在 `read_backup_payload` 删除非 zip JSON 解析分支。
- [ ] 在 `read_backup_payload` 删除 zip 内 `backup.json` fallback 分支，只接受 manifest/checksums/data 结构。
- [ ] 在 `src-tauri/src/domain/backup.rs` 删除 `BackupCompatibilityLevel::Legacy`。
- [ ] 将 `version < CURRENT_BACKUP_VERSION` 处理为不支持，或直接合并为 `unsupportedVersion`。
- [ ] 保留 `version > CURRENT_BACKUP_VERSION` 与 `schema_version > CURRENT_BACKUP_SCHEMA_VERSION` 的拒绝逻辑。
- [ ] 更新 Rust 内联备份测试，移除 legacy 兼容断言，新增“旧版本备份被拒绝”或“只接受当前版本”的断言。
- [ ] 更新 `tests/settingsPageState.test.ts` 中 backup preview mock 与不兼容流程断言。
- [ ] 跑 `npm run test:settings`、`npm run check:rust`。

### 5. 收窄备份 preview 边界字段

目标：把“兼容性”文案从长期 API 形状里降噪为“恢复安全状态”。

这一阶段可与第 4 阶段合并，也可以独立做。

- [ ] 将 Rust `BackupPreview` 的 `compatibility_level` 改为更明确的 `restore_status` 或 `restore_supported`。
- [ ] 将 `compatibility_message` 改为 `restore_message`。
- [ ] 删除 `compatibility_message_key` 与 `compatibility_message_args`，除非当前 UI 确实需要结构化国际化 key。
- [ ] 更新 `src/platform/backup/backupRuntimeGateway.ts` 的 raw DTO 与 camelCase 映射。
- [ ] 更新 `src/features/settings/services/settingsRuntimeAdapterService.ts` 的 summary 文案。
- [ ] 更新 `src/shared/copy/uiText.ts` 中 `backup.compatibility` 的命名与文案。
- [ ] 更新 `scripts/check-naming-boundaries.ts` 中允许的 raw 字段列表。
- [ ] 跑 `npm run check:naming` 与 `npm run test:settings`。

### 6. 过渡版本：保留 SQLite 迁移兼容

目标：下一版必须能从另一台电脑的 0.6.4 数据库正常启动。

- [x] 保留 `MIGRATION_4_SQL`、`MIGRATION_5_SQL`、`MIGRATION_6_SQL` no-op migration。
- [x] 保留 `repair_legacy_migration_history`。
- [x] 保留 `src-tauri/src/lib.rs` 启动时的 legacy repair 调用。
- [x] 增加 release note：升级后建议导出一份新备份。
- [x] 跑 `npm run check:rust`。

### 6B. 完全简并版本：最后处理 SQLite 迁移兼容

目标：不再维护已发布旧迁移历史。

保守结论：这是唯一可能直接影响当前 0.6.4 `timetracker.db` 启动的阶段。默认先暂缓；只有在确认可接受清库或可通过备份恢复时才执行。

- [ ] 执行前关闭所有 Time Tracker 进程。
- [ ] 关闭应用后再复制一次 `timetracker.db`、`timetracker.db-wal`、`timetracker.db-shm` 到 Downloads。
- [ ] 用当前应用或临时恢复路径确认结构化 `.zip` 可恢复。
- [ ] 如果选择“一次性清库 + 当前 schema 作为新基线”，在 `src-tauri/src/data/migrations.rs` 把当前 schema 合并成单一基线迁移：
  - [ ] `sessions` 包含 `continuity_group_start_time`
  - [ ] `settings` 保持当前 key/value 表
  - [ ] `icon_cache` 保持当前字段
  - [ ] 保留 `idx_sessions_date`
  - [ ] 保留 `idx_sessions_single_active`
- [ ] 删除 `MIGRATION_4_SQL`、`MIGRATION_5_SQL`、`MIGRATION_6_SQL` 以及对应 no-op migration entries。
- [ ] 删除 `src-tauri/src/data/sqlite_pool.rs` 的 `repair_legacy_migration_history` 与 `expected_migration_metadata`。
- [ ] 删除 `src-tauri/src/lib.rs` 启动时的 legacy repair 调用。
- [ ] 更新所有 Rust 测试 setup，不再手动执行 no-op migration 常量。
- [ ] 若保留现有迁移编号而非压成 v1，明确记录原因；不要留下“兼容 no-op”命名。
- [ ] 跑 `npm run check:rust`。

### 7. 验证与收尾

- [x] 跑 `npm run check:architecture`，确认没有新的跨层访问。
- [x] 跑 `npm run check:naming`，确认 raw 字段没有扩散。
- [x] 跑 `npm test`。
- [x] 跑 `npm run check:rust`，因为改到了 Rust backup/domain，若执行第 6 阶段还改到了 migrations。
- [x] 跑 `npm run check`。
- [x] 若第 4、5、6 阶段实际改变了数据/恢复边界，最终跑 `npm run check:full`。
- [x] 用 `rg -n -i "legacy|compat|compatibility_noop|repair_legacy|Legacy backup|BACKUP_JSON_ENTRY_NAME|color_scheme\\b|meeting\\\"\\)|finance\\\"\\)|reading\\\"\\)" src src-tauri/src tests scripts` 复扫残留。
- [ ] 如果本执行单完成，按文档卫生规则把本文件移入 `docs/archive/`，或把仍未完成的部分保留在 `docs/working/`。

## 推荐节奏

保守执行节奏如下：

1. 已完成：先生成结构化备份和原始数据库文件组备份。
2. 下一版第一批：删除 Classification 转发壳。
3. 下一版第二批：保留旧分类/旧设置读取，但把数据归一写回当前格式。
4. 下一版第三批：保留旧备份读取，只导出当前结构化 `.zip`。
5. 下一版第四批：保留 SQLite migration repair。
6. 下下版第一批：删除旧分类/旧设置/旧备份读取。
7. 下下版最后一批：在确认另一台电脑已跑过过渡版本后，再简并 SQLite migration。

只要当前 0.6.4 数据仍有保留价值，第 6 阶段就不应和前面几批混在同一次改动里。
