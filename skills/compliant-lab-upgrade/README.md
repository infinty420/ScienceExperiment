# compliant-lab-upgrade · 开源合规的深度升级工作台

一份可直接分发的 AgentSkill：把「参考 GitHub 开源项目做高深度升级」变成**可取证、可复现、可验收**的工程流程。

- 版本：`1.0.0`
- 级别：Advanced（SKILL.md + scripts + references + assets）
- 运行时：Node.js >= 18，**零外部依赖**
- 许可：`Proprietary`（见 `manifest.json`；技能包内所有脚本与文档为原创，不含任何第三方代码或素材）

## 适用场景

- 用户要求「查 GitHub 相似项目并参考」「全面升级」「复杂度和深度做上去」。
- 用户强调「务必合法合规」「先获取开源许可证」「避免 GPL/AGPL 传染」。
- 需要产出合规报告、`THIRD_PARTY_NOTICES.md`、实验包 DSL 校验与 CI 验收链。
- 教育科研仿真、虚拟实验、数据分析类项目的架构升级与技术选型论证。

## 目录结构

```
compliant-lab-upgrade/
├── SKILL.md                          # 主文档：六步工作流 + 硬性规则 + 渐进式披露
├── manifest.json                     # Clawhub 元数据（name/version/author/tags/entry/contents）
├── README.md                         # 本文件
├── scripts/
│   ├── gh_license_audit.mjs          # GitHub 检索 + LICENSE/README 全文取证
│   ├── package_check.mjs             # 实验包 DSL 体检（结构 + 注入面 + 答案越界）
│   └── validate_skill.mjs            # 技能包结构自检
├── references/
│   ├── research-workflow.md          # API 端点、限流、NOASSERTION、名称核查
│   ├── compliance.md                 # SPDX 三档分级、红线、报告与 NOTICE 写法
│   ├── upgrade-blueprint.md          # 六层架构与主/副线协同
│   ├── dsl-v2.md                     # 实验包 DSL v2 字段规范
│   └── acceptance.md                 # 验收链与 10 个数值算法坑
└── assets/
    ├── scene-template.json           # 实验包模板
    └── THIRD_PARTY_NOTICES.template.md
```

## 快速开始

### 1. 自检（先跑这个）

```bash
cd compliant-lab-upgrade
node scripts/validate_skill.mjs .
```

### 2. 合规调研取证

准备两个纯文本文件（每行一条）：

```
# queries.txt
virtual physics lab simulation education
circuit simulator javascript SPICE
experiment data curve fitting analysis education
```

```
# repos.txt
owner/repo-A
owner/repo-B
```

执行：

```bash
node scripts/gh_license_audit.mjs --queries queries.txt --repos repos.txt --out ./audit
```

产物：`audit/audit.json`、`audit/licenses/*.txt`、`audit/readmes/*.md`。
可选 `--readme owner/repo:main,owner/repo2:master` 抓取 README 作为架构思路参考。
可选环境变量 `GITHUB_TOKEN` 提高限流额度（不会写入产物）。

若网络存在代理拦截：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
  node scripts/gh_license_audit.mjs --queries queries.txt --repos repos.txt --out ./audit
```

### 3. 实验包体检（可接入 CI）

```bash
node scripts/package_check.mjs --dir ./experiments
node scripts/package_check.mjs --dir ./experiments --strict   # 警告也失败
```

错误时退出码为 1，可直接放进 GitHub Actions 步骤，**不要加 `|| exit 0`**。

## 安装

解压后把整个目录放到用户级技能目录：

```bash
unzip compliant-lab-upgrade-v1.0.0.zip -d <技能目录>/
```

或按 Clawhub 流程上传 zip。安装后由 Agent 按 `SKILL.md` 的 description 自动匹配触发场景。

## 上传 Clawhub 检查清单

- [x] `manifest.json` 含 `name` / `version` / `author` / `tags` / `entry` / `license`
- [x] `SKILL.md` 有合法 YAML frontmatter，description 含「何时使用」触发词
- [x] `SKILL.md` < 500 行，采用渐进式披露
- [x] `scripts/` / `references/` / `assets/` 齐全且非空
- [x] 脚本为 `node --check` 可通过的独立可执行脚本，无外部依赖
- [x] 无第三方代码、无 Logo/图标、无凭证或 token
- [ ] 上传前按目标平台要求确认 `license` 字段（当前为 Proprietary）

## 合规说明

本技能包是**方法论沉淀**：

- 所有脚本为原创实现，未复制任何开源项目源码。
- 文档中提及的算法（RK4、Dormand-Prince、LU、MNA、BKT、BM25 等）均为公开数学定义。
- 文档中提及的项目名仅用于说明「思想参考与合规边界」的取证方法，不构成关联、背书或商标使用。
- 使用前仍须针对你的具体目标项目独立完成许可证取证与本包第 2 节流程。

## 来源

提炼自一次真实的教育虚拟实验平台 V3 升级：57 个候选仓库检索、29 个仓库精确核查、23 份 LICENSE 全文取证、纯 TS 数值内核 / DSL v2 / 学习闭环 / 报告 3.0 / 工程化验收的落地过程，以及其中 10 个真实踩坑记录。
