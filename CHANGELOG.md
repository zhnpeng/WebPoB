## v0.3.0 - 2026-11-27

- 深度对齐 PoB1/PoB2 计算引擎（SkillStatMap 编译宝石、组合式 ModParser、多 Actor/星团运行时）；新增国服 WeGame PoE 2 与 Maxroll 链接直导及国际服繁中（zh-TW）支持

## v0.2.3 - 2026-11-27

- 技能页新增主动/辅助宝石中英文及标签实时搜索选择器，支持分类筛选与键盘快选

## v0.2.2 - 2026-11-27

- 隐私脱敏加固、发布文档独立索引化与 Web Analytics 探针生效发布

## v0.2.1 - 2026-11-27

- 上线 manifest.json 数据契约、多版本历史天赋树支持与动态职业升华加载；增强 Ninja E2E 结构化报告与公网跳转稳健性

## v0.2.0 - 2026-11-26

- 版本管理与秒级回滚系统上线；修复 Service Worker 缓存旧天赋树 JSON 导致老用户看到未汉化节点的问题

# Changelog

All notable changes to WebPoB are documented in this file.

本文件记录 WebPoB 的重要变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/)；英文技术术语与中文说明混排，便于检索与审阅。

## [Unreleased]

### Planned

- 发布流程自动化：版本台账、预发预览、线上验活与一键回滚的持续打磨。
- 继续补全 PoE 1 / PoE 2 官方数据、中文词条与构筑回归覆盖。

## [0.1.1] - 2026-11-26

对应提交：`fd67782`（`feat(i18n,test): full poedb/PoeCharm ZH tree & gem coverage + 12-build poe.ninja regression suite`）

### Added

- **完整 POE 编年史（PoeCharm / PoeCharm2）中文本地化**：接入 PoeCharm 与 PoeCharm2 词库，覆盖天赋树、技能宝石与关键机制文本。
  - PoE 2 天赋与宝石中文覆盖率 **100%**。
  - PoE 1 中文覆盖率 **98.8%**，并补齐 **48/48** 基石（Keystones）中文名称。
- **12 套 `poe.ninja` 构筑回归测试套件**：PoE 1 与 PoE 2 各 6 套，覆盖 codec 导入、天赋节点存在性、DPS/EHP 数值有限性、诊断执行、文本与 i18n 泄漏检查，以及浏览器 E2E（Desktop / Mobile）。
- 发布核验脚本入口：`pnpm test:e2e:ninja`，用于本地与 CI 复用同一套 Ninja 构筑端到端验证。

### Changed

- 中英文词条回退策略与 `localizeText` / `localizeStatLine` 覆盖范围扩展，减少天赋、宝石与词缀中的未翻译文本。
- 回归断言新增中文名称、中文属性行、宝石名称覆盖率，以及 `[Key|Display]`、字面量 `\n`、`undefined` / `NaN` / `[object Object]` / 原始 i18n key 泄漏检查。

### Fixed

- 修复部分 PoE 1 基石与 PoE 2 天赋、宝石在中文界面下仍显示英文或原始 key 的问题。
- 修复 Ninja 构筑导入后天赋节点缺失、数值非有限值等回归无法被自动捕获的问题。

## [0.1.0] - 2026-11-26

对应提交：`a313388`（`feat(web): overhaul mobile RWD for TopBar, PassiveTree HUD, and ItemsTab`）

### Added

- **自动浏览器语言检测**：默认跟随浏览器 `navigator.language`，支持通过 `?lang=` 查询参数强制指定 `en` / `zh`（含 `zh-CN` / `zh_CN` 等变体）。
- 移动端单行 Passive Tree HUD 与自动适配视野（auto-fit），在小屏上优先保证天赋树可读性。

### Changed

- **移动端 RWD 全面重构**：紧凑版 TopBar 与菜单抽屉（menu sheet），减少小屏横向占用与换行错位。
- ItemsTab 装备列表、属性行与操作按钮支持自动换行，修复窄屏溢出与遮挡。
- 被动天赋树在移动端支持单指拖拽、双指捏合缩放，并在视口变化时保持合理缩放与居中。

### Fixed

- 修复移动端 TopBar 与天赋树 HUD 重叠、按钮不可点击的问题。
- 修复 ItemsTab 在 390px 宽度下出现横向滚动、文本截断与布局抖动的问题。

