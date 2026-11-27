# WebPoB 生产上线与回滚索引（Deploy & Rollback Index）

本文件为**索引页**，每次发布（`PROD_DEPLOY` / `PREVIEW_DEPLOY`）与回滚（`ROLLBACK` / `AUTO_ROLLBACK`）的完整详情均保存在 `docs/deploys/` 下的独立 Markdown 文件中，由 [scripts/release.mjs](../scripts/release.mjs) 自动生成并追加索引。

| 时间 (UTC) | 操作 | 环境 | 版本 | Commit | Deployment | 结果 | 独立记录 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-11-27T17:25:41.472Z | `PROD_DEPLOY` | Production | `v0.3.0` | `17ff0ed` | `b7447204` | Smoke 4/4 PASS | [2026-11-27-1725-prod-v0.3.0.md](./deploys/2026-11-27-1725-prod-v0.3.0.md) |
| 2026-11-27T10:45:39.226Z | `PROD_DEPLOY` | Production | `v0.2.3` | `f1029ad` | `5b0b74c2` | Smoke 4/4 PASS | [2026-11-27-1045-prod-v0.2.3.md](./deploys/2026-11-27-1045-prod-v0.2.3.md) |
| 2026-11-27T09:19:08.545Z | `PROD_DEPLOY` | Production | `v0.2.2` | `a04efa8` | `3c8d65b9` | Smoke 4/4 PASS | [2026-11-27-0919-prod-v0.2.2.md](./deploys/2026-11-27-0919-prod-v0.2.2.md) |
| 2026-11-27T05:01:35Z | `PROD_DEPLOY` | Production | `v0.2.1` | `e486295` | `e9312d4a` | Smoke 4/4 PASS | [2026-11-27-0501-prod-v0.2.1.md](./deploys/2026-11-27-0501-prod-v0.2.1.md) |
| 2026-11-26T16:08:31Z | `PROD_DEPLOY` | Production | `v0.2.0` | `6c1c6a4` | `f1996f9a` | Smoke 4/4 PASS | [2026-11-26-1608-prod-v0.2.0.md](./deploys/2026-11-26-1608-prod-v0.2.0.md) |
| 2026-11-26T16:06:45Z | `AUTO_ROLLBACK` | Production | `v0.1.0` | `a313388` | `cb3f1033 -> 97494805` | Smoke 4/4 PASS | [2026-11-26-1606-auto-rollback-v0.1.0.md](./deploys/2026-11-26-1606-auto-rollback-v0.1.0.md) |
| 2026-11-26T15:49:06Z | `PROD_DEPLOY` | Production | `v0.1.1` | `fd67782` | `1a732a05` | Proxy 200 + ZH 100% | [2026-11-26-1549-prod-v0.1.1.md](./deploys/2026-11-26-1549-prod-v0.1.1.md) |
| 2026-11-26T15:02:47Z | `PROD_DEPLOY` | Production | `v0.1.0` | `a313388` | `97494805` | RWD + Proxy 200 | [2026-11-26-1502-prod-v0.1.0.md](./deploys/2026-11-26-1502-prod-v0.1.0.md) |
