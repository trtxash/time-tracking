# 兼容代码简并执行方案

更新时间：2026-05-15

本文是一次性执行方案，放在 `docs/working/` 下。它不是长期规则；长期规则仍以顶层 `docs/` 文档为准。

当前目标是：先让 `0.6.5` 成为安全过渡版本，等所有仍有价值的数据都跑过一次过渡版本后，再在之后的版本里完全移除旧兼容代码。

## 当前状态

- [x] `0.6.5` 过渡版本代码已完成。
- [x] `0.6.5` 本地发布校验已通过：`npm run release:check -- 0.6.5`。
- [x] `main` 已推送到 GitHub。
- [x] `v0.6.5` tag 已推送到 GitHub。
- [ ] 等待 GitHub Actions `Publish Release` 完成并生成 Release、安装包、`latest.json`。
- [ ] 等待当前电脑升级到 `0.6.5` 后确认数据正常。
- [ ] 等待另一台已安装 Time Tracker 的电脑升级到 `0.6.5` 后确认数据正常。
- [ ] 开始完全简并前，至少在 `0.6.5` 内导出一份新的结构化 `.zip` 备份作为临时回滚点。
- [ ] 完全简并版本尚未开始实施。

发布工作流：

- `Publish Release` run: https://github.com/Ceceliaee/time-tracking/actions/runs/25920387288

## 一句话结论

不要从 `0.6.4` 直接跳到完全简并版本。

安全路径是：

`0.6.4` → `0.6.5 过渡版本` → `确认数据正常` → `导出临时回滚备份` → `之后版本完全简并`

只要每台仍保留旧数据的电脑都成功跑过 `0.6.5`，之后再升级到完全简并版本时，用户通常不需要手动恢复 Downloads 里的备份。新导出的 `.zip` 是删除兼容代码前的保险，不是正常升级步骤，也不需要永久保存。

## 已有备份

这些备份是回滚保险，不是正常升级步骤。

- [x] 结构化备份：`C:\Users\SYBao\Downloads\TimeTracker-backup-20260515-205401.zip`
- [x] 原始 SQLite 文件组：`C:\Users\SYBao\Downloads\TimeTracker-raw-db-20260515-205417\`
- [x] 原始 SQLite 文件组包含：
  - [x] `timetracker.db`
  - [x] `timetracker.db-wal`
  - [x] `timetracker.db-shm`

继续保留这些旧备份，直到：

- [ ] 当前电脑已成功升级并运行 `0.6.5`。
- [ ] 另一台电脑已成功升级并运行 `0.6.5`。
- [ ] 完全简并前已导出新的 `.zip` 临时回滚备份。
- [ ] 完全简并版本发布并正常运行一段时间。

## 兼容代码清单

| 兼容类别 | 当前状态 | 下一步 |
| --- | --- | --- |
| Classification 转发壳 | 已在 `0.6.5` 删除 | 无需继续处理 |
| 旧分类值读取 | `0.6.5` 保留读取并写回当前 JSON | 完全简并版本删除旧解析 |
| 旧设置值读取 | `0.6.5` 保留读取并写回当前 key | 完全简并版本删除旧 fallback |
| 旧备份格式读取 | `0.6.5` 保留导入，导出只用新 `.zip` | 完全简并版本删除旧导入 |
| 备份 preview 兼容字段 | `0.6.5` 仍保留旧字段名 | 可在完全简并版本一起改名 |
| SQLite migration repair | `0.6.5` 必须保留 | 最后处理，风险最高 |

不应删除的内容：

- `src/shared/classification/processNormalization.ts` 中 installer、updater、tray alias 归一化。这是追踪正确性，不是旧用户兼容。
- `src/shared/lib/sessionReadCompiler.ts` 中 alias 聚合。这是统计一致性，不是旧 API 兼容。
- Tauri / Rust / SQLite 边界的 snake_case raw DTO 映射。这是协议边界，不是遗留壳。
- 备份 “version/schema 过新不可恢复” 的拒绝逻辑。这是数据安全门槛。

## 阶段 A：`0.6.5` 过渡版本

状态：已完成并已推送发布 tag，等待 GitHub Actions 出包。

完成内容：

- [x] 删除 6 个 classification 历史转发壳。
- [x] 调用方直接使用 `src/shared/classification/*`。
- [x] 旧分类 override 可读取，并在加载时写回当前 JSON / 当前 category。
- [x] 旧设置 `color_scheme` 可读取，并写回 `color_scheme_light` / `color_scheme_dark`。
- [x] 旧设置 `minimize_behavior = tray` 可读取，并写回当前语义。
- [x] 旧 `.json`、`.ttbackup`、旧 zip 内 `backup.json` 仍可导入。
- [x] 新导出的备份只使用当前结构化 `.zip`。
- [x] 保留 `repair_legacy_migration_history` 与 no-op migration。
- [x] `CHANGELOG.md` 已固化 `0.6.5` 发布说明。

已通过验证：

- [x] `npm run test:classification`
- [x] `npm run test:settings`
- [x] `npm run test:replay`
- [x] `npm run check:architecture`
- [x] `npm run check:naming`
- [x] `npm run check:rust`
- [x] `npm run check:full`
- [x] `npm run release:check -- 0.6.5`

## 阶段 B：发布后升级验证

目标：确认 `0.6.5` 已经完成“旧数据 → 当前格式”的过渡职责。

先等待：

- [ ] GitHub Actions `Publish Release` 结束且状态为成功。
- [ ] GitHub Release 页面出现 `v0.6.5`。
- [ ] Release 附件包含 Windows 安装包。
- [ ] Release 附件包含 updater 使用的 `latest.json`。

当前电脑验证：

- [ ] 从 `0.6.4` 或当前安装版升级到 `0.6.5`。
- [ ] 启动应用，确认没有数据库启动错误。
- [ ] 检查 Today / History / Data / App Mapping / Settings 能正常打开。
- [ ] 检查历史数据、应用分类、设置项没有明显丢失。
- [ ] 可选：在 Settings 内导出一份新的结构化 `.zip` 备份，作为之后完全简并前的临时回滚点。
- [ ] 如果导出了新备份，记录新备份路径。

另一台电脑验证：

- [ ] 通过 updater 或安装包升级到 `0.6.5`。
- [ ] 启动应用，确认没有数据库启动错误。
- [ ] 检查历史数据、应用分类、设置项没有明显丢失。
- [ ] 可选：在 Settings 内导出一份新的结构化 `.zip` 备份，作为之后完全简并前的临时回滚点。
- [ ] 如果导出了新备份，记录新备份路径。

阶段 B 通过标准：

- [ ] 两台电脑都成功启动过 `0.6.5`。
- [ ] 两台电脑都确认主要数据正常。
- [ ] 完全简并前至少导出过一份新的 `.zip` 临时回滚备份。
- [ ] 没有仍需从旧 `.json`、`.ttbackup`、旧 zip 内 `backup.json` 恢复的数据。

## 阶段 C：完全简并版本门禁

只有全部勾选后，才能开始删除兼容代码。

- [ ] `0.6.5` Release 已正式发布成功。
- [ ] 当前电脑已运行过 `0.6.5`。
- [ ] 另一台已安装电脑已运行过 `0.6.5`。
- [ ] 所有需要保留的数据都已在 `0.6.5` 中正常显示。
- [ ] 开始完全简并前，已导出至少一份 `0.6.5` 结构化 `.zip` 临时回滚备份。
- [ ] 明确接受完全简并版本不再读取旧设置、旧分类、旧备份格式。
- [ ] 开始前再次确认 git 工作区干净，或明确哪些改动属于本次任务。

建议版本号：

- 默认先按 `0.6.6` 准备。
- 如果完全简并包含明显用户可感知变化或发布策略变化，再按 `docs/versioning-and-release-policy.md` 判断是否升到 `0.7.0`。

## 阶段 D：完全简并实施批次

按下面顺序执行。不要把 SQLite migration repair 提前到前面几批。

### D1. 删除旧分类值兼容

目标：分类 override 只接受当前 JSON 存储格式与当前 category 集。

- [ ] 在 `src/shared/classification/processMapper.ts` 删除旧 category 映射：
  - [ ] `meeting -> office`
  - [ ] `finance -> utility`
  - [ ] `reading -> browser`
  - [ ] 旧 `"custom"` 字符串兜底
- [ ] 保留当前 `custom:<name>` 格式支持。
- [ ] 删除 `fromOverrideStorageValue` 的纯字符串 category fallback。
- [ ] 更新 `tests/classificationDraftState.test.ts`。
- [ ] 跑 `npm run test:classification`。
- [ ] 跑 `npm run test:replay`。

### D2. 删除旧设置值兼容

目标：设置解析只支持当前字段与当前枚举。

开始前检查数据库中是否还有旧值：

- [ ] `color_scheme`
- [ ] `minimize_behavior = tray`
- [ ] 其他已退出枚举值

执行项：

- [ ] 在 `src/platform/persistence/appSettingsStore.ts` 删除 `RawAppSettingsKey` 中的旧 `color_scheme`。
- [ ] `colorSchemeLight` 只读取 `color_scheme_light`。
- [ ] `colorSchemeDark` 只读取 `color_scheme_dark`。
- [ ] `normalizeMinimizeBehavior` 只接受 `"widget"` / `"taskbar"`。
- [ ] 在 `src-tauri/src/domain/settings.rs` 同步收窄 `parse_minimize_behavior`。
- [ ] 更新 `tests/settingsPageState.test.ts`。
- [ ] 更新 Rust settings 相关测试。
- [ ] 跑 `npm run test:settings`。
- [ ] 跑 `npm run check:rust`。

### D3. 删除旧备份格式导入

目标：只支持当前结构化 `.zip` 备份格式。

前置条件：

- [ ] 已确认不再需要恢复旧 `.json`。
- [ ] 已确认不再需要恢复旧 `.ttbackup`。
- [ ] 已确认不再需要恢复旧 zip 内 `backup.json`。
- [ ] 至少一份新结构化 `.zip` 已成功 preview。

执行项：

- [ ] 在 `src-tauri/src/data/backup.rs` 删除 `BACKUP_JSON_ENTRY_NAME`。
- [ ] 在 `pick_backup_file` 删除 `"Legacy backup files"` 过滤器。
- [ ] 在 `read_backup_payload` 删除非 zip JSON 解析分支。
- [ ] 在 `read_backup_payload` 删除 zip 内 `backup.json` fallback。
- [ ] 在 `src-tauri/src/domain/backup.rs` 删除 `BackupCompatibilityLevel::Legacy`。
- [ ] 将 `version < CURRENT_BACKUP_VERSION` 处理为不支持。
- [ ] 保留 `version > CURRENT_BACKUP_VERSION` 与 `schema_version > CURRENT_BACKUP_SCHEMA_VERSION` 的拒绝逻辑。
- [ ] 更新 Rust 备份测试。
- [ ] 更新 `tests/settingsPageState.test.ts` 中 backup preview mock。
- [ ] 跑 `npm run test:settings`。
- [ ] 跑 `npm run check:rust`。

### D4. 收窄备份 preview 边界字段

目标：把“兼容性”命名改成“恢复安全状态”命名。

这批可以和 D3 合并，也可以单独提交。

- [ ] 将 Rust `BackupPreview.compatibility_level` 改为 `restore_status` 或 `restore_supported`。
- [ ] 将 `compatibility_message` 改为 `restore_message`。
- [ ] 评估是否删除 `compatibility_message_key` 与 `compatibility_message_args`。
- [ ] 更新 `src/platform/backup/backupRuntimeGateway.ts`。
- [ ] 更新 `src/features/settings/services/settingsRuntimeAdapterService.ts`。
- [ ] 更新 `src/shared/copy/uiText.ts`。
- [ ] 更新 `scripts/check-naming-boundaries.ts`。
- [ ] 跑 `npm run check:naming`。
- [ ] 跑 `npm run test:settings`。

### D5. 最后处理 SQLite migration repair

目标：不再维护已发布旧迁移历史。

这是最高风险批次。只有在确认所有数据都跑过 `0.6.5` 后才能执行。

执行前：

- [ ] 关闭所有 Time Tracker 进程。
- [ ] 再复制一次 `timetracker.db`、`timetracker.db-wal`、`timetracker.db-shm` 到 Downloads。
- [ ] 确认新结构化 `.zip` 可以 preview。
- [ ] 确认接受旧 0.6.4 数据库不再直接跳过 `0.6.5` 打开。

执行项：

- [ ] 删除 `MIGRATION_4_SQL`、`MIGRATION_5_SQL`、`MIGRATION_6_SQL` no-op migration。
- [ ] 删除 `src-tauri/src/data/sqlite_pool.rs` 的 `repair_legacy_migration_history`。
- [ ] 删除 `expected_migration_metadata` 中只为旧迁移修复服务的内容。
- [ ] 删除 `src-tauri/src/lib.rs` 启动时的 legacy repair 调用。
- [ ] 更新所有 Rust 测试 setup，不再手动执行 no-op migration 常量。
- [ ] 若保留当前迁移编号而不压成 v1，必须在代码或文档中说明原因。
- [ ] 跑 `npm run check:rust`。

## 完全简并验证门槛

每批之后至少跑该批列出的局部测试。全部完成后跑完整门槛：

- [ ] `npm run check:architecture`
- [ ] `npm run check:naming`
- [ ] `npm test`
- [ ] `npm run test:replay`
- [ ] `npm run test:settings`
- [ ] `npm run test:classification`
- [ ] `npm run check:rust`
- [ ] `npm run check:full`

发布前门槛：

- [ ] 更新 `CHANGELOG.md`。
- [ ] 同步目标版本号。
- [ ] 跑 `npm run release:check -- <version>`。
- [ ] 提交 `release: v<version>`。
- [ ] 推送 `main`。
- [ ] 推送 `v<version>` tag。
- [ ] 确认 GitHub Actions `Publish Release` 已触发。

## 暂停条件

出现任一情况就暂停，不继续删除兼容代码：

- [ ] `0.6.5` GitHub Actions 发布失败。
- [ ] 任意一台电脑升级到 `0.6.5` 后数据库打不开。
- [ ] 升级后历史数据、设置、应用映射有明显丢失。
- [ ] 无法导出新的结构化 `.zip` 备份。
- [ ] 仍需要从旧 `.json`、`.ttbackup` 或旧 zip 内 `backup.json` 恢复数据。
- [ ] 当前工作区出现无法归属的未提交改动。

## 文档收尾

- [ ] 完全简并版本发布后，把本文移到 `docs/archive/`。
- [ ] 如果完全简并后产生长期规则变化，更新对应的顶层 `docs/` 文档，而不是继续修改本文。
