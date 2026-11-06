---
name: compliant-lab-upgrade
description: 对教育/科研仿真、虚拟实验或数据分析类项目执行「GitHub 开源合规调研 + 高深度升级」的端到端工作流。先检索相似仓库并抓取 LICENSE 全文取证，按 SPDX 分级划定可复用边界，再落地平台无关的数值内核、实验包 DSL、学习闭环、结构化报告与工程化验收。当用户提出「参考开源项目做全面升级」「把复杂度和深度做上去」「务必合法合规」「先查许可证」「避免 GPL/AGPL 传染」「产出第三方声明」时使用；也适用于开源合规审计、许可证取证与技术选型论证。
---

# 开源合规的深度升级工作台

把「参考开源项目」这件事做成**可取证、可复现、可验收**的工程流程，而不是复制代码。

## 核心原则（不可协商）

1. **合规先行**：任何设计/编码动作之前，先完成许可证取证并划定红线。取证未完成不得开始实现。
2. **只借鉴思想**：公开论文、教科书算法、README 中的架构描述可以借鉴；源码、资源、文案、图标、名称、商标一律不复制，除非其许可证明确允许且已完成归属声明。
3. **Copyleft 零复用**：GPL / AGPL / LGPL / SSPL 项目仅作为「思路参考」。哪怕是一行代码、一个 SVG、一段文案，都不得进入目标仓库。
4. **零新增运行时依赖**：深度升级靠自己实现的纯 TS/JS 内核，不靠堆库。新增依赖前必须先查 SPDX 并写入第三方声明。
5. **证据留档**：许可证全文、检索结果、核查结论落盘为报告，报告与代码同批提交。
6. **名称隔离**：检查项目代号是否与已有知名开源产品近似；近似则出具无关联声明，并在公开发布前改名。

## 工作流

### Step 1 · 基线摸底（只读）

先看清目标仓库，不要一上来就写方案：

- 分支、最近提交、工作区 WIP（**WIP 属于用户资产，升级时一并保留并提交，不要擅自回滚**）。
- 目录分层与「主/副线」关系（例如 PC 主线 + 移动端 WebView 副线，副线应复用主线源码）。
- 现有依赖清单与各自许可证。
- 真实瓶颈：死代码、脆弱的数据契约、仅有 localStorage 的持久化、无测试/无 typecheck/无 CI、无 README/无第三方声明。

### Step 2 · 合规调研与取证

使用 `scripts/gh_license_audit.mjs`：

```bash
node scripts/gh_license_audit.mjs \
  --queries queries.txt \
  --repos repos.txt \
  --out ./audit
```

- 广域检索用 10–15 组关键词，去重后形成候选池。
- 精确核查 20–30 个高相关仓库，抓 `/repos/{owner}/{repo}` 与 `/license` 元数据 + LICENSE 全文。
- 遇 403 限流：**记录失败、不绕过、不伪造**，用已取得的样本 + 官方页面交叉验证即可。
- `NOASSERTION` 不等于「无许可证」，必须查官方 Wiki / 官方站 / 项目 FAQ 补足结论。
- 结论写入 `docs/开源项目调研与合规报告.md`，格式见 `references/compliance.md`。

端点细节与限流应对见 `references/research-workflow.md`。

### Step 3 · 划定合规边界并落成方案

按 SPDX 分成三档：

| 档位 | 典型许可证 | 允许动作 |
|---|---|---|
| 宽松 | MIT / Apache-2.0 / BSD / Zlib / ISC | 可复用代码，但须保留版权头与 NOTICE；本工作流建议**仍只取思路并列名致谢** |
| 弱 Copyleft | LGPL / MPL / EPL | 动态链接等有条件的复用；本工作流**默认零复用** |
| 强 Copyleft | GPL / AGPL / SSPL / CeCILL | **仅参考公开算法思想与架构描述**，零代码、零资源、零命名 |

产出 `docs/升级方案V3.md`：新增目录、参考映射（哪个思想来自哪个项目但不含代码）、文件级改动清单、验收标准、风险规避。

### Step 4 · 分层实现

按 `references/upgrade-blueprint.md` 的六层推进，**每层平台无关、每层可独立测试**：

1. **数值内核** — 线性代数 / ODE / 安全表达式 / 量纲 / 拟合 / 统计与不确定度 / 电路 MNA / 可复现随机数。
2. **包 DSL v2** — `meta`（版本、许可证、思想来源、教学目标）+ `solver` + `analysis`；自研校验器、运行时注册、导入导出、V1 迁移。
3. **学习闭环** — 持久层（IndexedDB + 降级）、BKT、遗忘曲线排程、错题本、推荐器。
4. **可复现性与报告** — 纯 TS SHA-256、快照（参数/种子/求解器/校验和）、结构化报告导出 MD/HTML/SVG/CSV/JSON。
5. **离线助教** — BM25 中文二元字 gram、LaTeX 子集渲染、数据诊断、可插拔 LLM 适配器（默认离线、失败回退）。
6. **界面接线** — 把内核暴露成研究台与学习中心，并接通原有实验台的分析/快照/报告/答题明细。

DSL 字段规范与模板见 `references/dsl-v2.md`、`assets/scene-template.json`。
第三方声明模板见 `assets/THIRD_PARTY_NOTICES.template.md`。

### Step 5 · 工程化与验收

```bash
npm run typecheck
npm test
node scripts/package_check.mjs --dir <实验包目录>
npm run build
npx vite build --config vite.hos.config.ts   # 如有副线
python scripts/inline_hos.py <输出目录>       # 如有副线
```

- 测试链：`esbuild` 打包 TS 测试 → `node --test`，**不引入测试框架**。
- 独立实验包体检脚本 `scripts/package_check.mjs` 应能在无构建环境时单独运行。
- 数值算法的常见坑与阈值设定见 `references/acceptance.md`（务必先读，能省掉大量调试）。
- 最终补齐 `README.md`、`THIRD_PARTY_NOTICES.md`、CI workflow。

### Step 6 · 交付与同步

1. 完整验收全绿后再提交，提交信息按「模块 → 具体能力 → 验证结果」组织。
2. 推送前先 `git fetch`；若远端存在不同 SHA 但 `tree` 一致的提交（常见于 API 兜底推送），**先逐对比对 tree**，确认本地是内容超集后再用 `git push --force-with-lease=<branch>:<远端SHA>`，绝不裸 `--force`。
3. 同步完成后追加当日工作日志与项目长期约定。

## 渐进式披露

只在需要时读取对应参考文档，不要一次性把全部内容塞进上下文：

| 何时读 | 文档 |
|---|---|
| 开始调研、遇到 403 / NOASSERTION | `references/research-workflow.md` |
| 判定许可证、写合规报告或 NOTICE | `references/compliance.md` |
| 设计升级分层与迁移策略 | `references/upgrade-blueprint.md` |
| 定义或校验实验包 | `references/dsl-v2.md` |
| 写测试、调数值算法、验收 | `references/acceptance.md` |

## 反模式（出现过真实事故）

- 注释里写 `path/*/file.json`：`*/` 会提前闭合块注释，导致脚本语法错误。写 `path/<id>/file.json`。
- 直接 `Math.min(...hugeArray)`：大样本爆栈，改循环。
- 快照校验和对内存对象直接哈希：JSON 往返后 `undefined` 字段消失导致校验和不匹配，先 `JSON.parse(JSON.stringify(x))` 归一化。
- 用 `eval` / `new Function` 解析包内表达式：外部包即注入面，必须自己写 Tokenizer + Pratt 解析器。
- 把「API 返回 NOASSERTION」当成「可自由使用」。
- 为图省事把 GPL 项目的算法实现整段翻译过来。

## 自检

交付前运行 `node scripts/validate_skill.mjs .`，确认 frontmatter、manifest、目录结构与脚本齐全。
