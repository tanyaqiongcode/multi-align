# AGENTS.md — AI 协作规范（multi-align）

本项目已接入完整工程化规范（husky + commitlint / eslint / pre-commit / gitleaks / CI）。AI agent 在本仓库工作时遵守以下约定。

## 项目概要
纯前端多语平行语料句对齐工作台（零运行时依赖 JavaScript）：`index.html` + `js/`（浏览器经典脚本，window.PA 命名空间）、`benchmark/` 与 `agent-skill/scripts/`（Node CommonJS）、`analytics/`（Cloudflare Worker ESM）、`test/`。

## 常用命令
```bash
npx eslint .                                      # lint（0 error 0 warning，no-unused-vars 为 error）
node agent-skill/scripts/pipeline_test.js         # 无头回归（数量以脚本输出为准），必须全过
node benchmark/run_benchmark.js --min-f1 0.97     # F1 基准（基线 100%），必须达标
uvx pre-commit run --all-files                    # 提交前全量自检
```

## 提交规范
- 提交信息：Conventional Commits（`<type>(<scope>)?: <subject>`），husky 的 commit-msg 钩子（commitlint）强制校验。
- pre-commit 钩子 = lint-staged（eslint --fix）+ pre-commit 框架（卫生 + gitleaks）；钩子改了文件 → `git add -u` 重新提交；**禁止 --no-verify**。
- lint 级修复与功能改动分开提交。

## 行为红线
- **绝不引入运行时依赖、打包器或构建步骤**——"零依赖、双击 index.html 即用"是本项目的核心性质，所有新依赖仅限 devDependencies。
- **package.json 不加 `"type": "module"`**：`benchmark/` 与 `agent-skill/scripts/` 是 CommonJS（CI 直接 node 运行），写了会破坏现有测试。
- eslint 按目录区分环境（js/test=浏览器 script；benchmark/agent-skill=Node CJS；analytics=Worker ESM），新目录需在 eslint.config.mjs 登记对应环境。
- `*.md` 行尾双空格是刻意的换行语义（已从 trailing-whitespace 排除），不要清理。
- HTML 内联 `<script>` 不在 eslint 覆盖范围，改内联脚本后必须手跑两条回归命令。
