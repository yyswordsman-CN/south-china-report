# Release Process — CI、发布检查与安全安装

## 发布前门禁

```bash
npm ci
npx playwright install chromium
npm test
npm run release:check
```

CI 在 Python 3.11 / Node 22 上执行同一条链，并用临时目录验证一次 `--apply` 与 `--check`。`release:check` 会核对 SemVer、锁文件、主文档版本、Skill frontmatter、发布清单与关键文件。

默认由 Playwright 使用项目已安装的 Chromium。如本机需与其他无头浏览器任务隔离，可显式设置 `SCR_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium` 指定可执行文件；未设置时不改变本地或 CI 默认行为。

## 报告构建与 Skill 发布不要混淆

`scripts/build-report.mjs` 发布的是单次报告产物目录，不会安装 Skill、修改真实安装副本或操作 Git：

```bash
node scripts/build-report.mjs \
  --metrics metrics.json --insights insights.json \
  --spec report-spec.json --out-dir report-build
```

只有返回 `status=OK` 且 `delivery_ready=true`，才表示七段自动 Gate 全部通过并已原子发布本地报告目录。`UNVERIFIED`、诊断目录、local build 和安装目录同步是不同状态；自动截图通过后仍须人工逐张目检。

## 发布清单

`release-profile.json` 是唯一发布范围真源。它包含 Skill 指令、模板、引用、脚本、测试、eval 和演示真源；排除截图、缓存、依赖目录与编译产物。禁止手工复制一个未经清单验证的目录并称为正式安装。

## 安装或同步

目标目录名必须严格为 `south-china-report`，且不得与发布源相同或互相嵌套。

```bash
# 只读预览差异；默认推荐先跑
node scripts/install-skill.mjs --target /path/to/south-china-report --dry-run

# CI/验收：有任何缺失、变化或额外文件即失败
node scripts/install-skill.mjs --target /path/to/south-china-report --check

# 需要明确授权：完整 staging、原子替换、发布后逐文件复检
node scripts/install-skill.mjs --target /path/to/south-china-report --apply
```

`--apply` 不做增量覆盖：先在目标父目录构建完整 staging，再把旧安装重命名为时间戳备份，原子放入新版本。发布后复检失败时会恢复旧副本；成功时保留 `.south-china-report.backup-*` 供人工回滚。安装目录内的 `.south-china-report-install.json` 记录版本和 release digest，不属于源码真源。

## 版本步骤

1. 更新 `package.json`、`package-lock.json`、`SKILL.md`、`README.md`、`USAGE-GUIDE.md`、`CHANGELOG.md` 与 `requirements.txt` 的版本声明。
2. 重建 demo，并运行全量测试与 `release:check`。
3. 对真实安装目录先执行 `--dry-run`；没有用户明确授权不得执行 `--apply`。
4. 如需 Git 发布，再单独提交、推送或打标签；本安装脚本不会自动操作 Git，也不会发布到外部平台。
