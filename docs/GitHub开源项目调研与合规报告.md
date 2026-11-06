# GitHub 相似开源项目调研与许可证合规报告

> 调研日期：2026-11-06 · 调研对象：智实验（ScienceExperiment / 内部代号 SciLab）
> 调研目的：为 V3 全面升级寻找可借鉴的工程与算法思路，并在动手前完成许可证取证与法律边界界定。
> 声明：本报告为工程合规记录，不构成法律意见。所有许可证原文已抓取存档（取证方式见 §1）。

---

## 1. 调研方法与取证

| 步骤 | 做法 | 结果 |
|---|---|---|
| 广域检索 | GitHub REST API `search/repositories`，12 组关键词（虚拟实验室 / 交互式物理仿真 / 电路 MNA / 化学实验 / 学习算法 / 知识追踪 / 学习分析），按 stars 排序 | 去重后 **57** 个仓库，落盘 `.workbuddy/tmp/gh_repos.json` |
| 精确核查 | 对 **29** 个点名仓库请求 `/repos/{owner}/{repo}` 元数据 + `/license` 端点 | 落盘 `.workbuddy/tmp/gh_license_audit.json` |
| 许可证全文取证 | 解码 `/license` 返回的 base64 内容，逐仓库保存原文 | **23** 份 LICENSE 全文，落盘 `.workbuddy/tmp/licenses/*.txt` |
| 架构参考 | 抓取 11 个重点仓库 README（raw.githubusercontent.com）+ 递归目录树 | 落盘 `.workbuddy/tmp/readmes/*.md` |
| 交叉验证 | 对 GitHub API 返回 `NOASSERTION` 的项目（PhET / Anki / OSP / Scilab），查官方许可页与授权说明 | 见 §3.3 |

本轮**未复制、未下载、未嵌入任何第三方源码或二进制资源**；README 与目录树仅用于理解架构与术语。

---

## 2. 参考矩阵（按可复用性分级）

### 2.1 宽松许可 —— 允许借鉴实现，甚至可复用代码（须保留版权与许可证）

| 项目 | Stars | 许可证（SPDX） | 借鉴内容 → 本项目 V3 落点 |
|---|---:|---|---|
| [myphysicslab/myphysicslab](https://github.com/myphysicslab/myphysicslab) | 453 | **Apache-2.0** | `DiffEqSolver` / `AdaptiveStepSolver` / `EulersMethod` / `EnergySystem` / `CollisionAdvance` 的分层抽象；约 50 个仿真共用一个求解器接口的设计 → `kernel/ode.ts`（求解器族、自适应步长、事件与能量诊断）、DSL v2 的 `solver` 声明 |
| [Concord-Consortium/codap](https://github.com/Concord-Consortium/codap) | 107 | **MIT**（早期 Apache-2.0） | 「仿真流式产出 case 数据 → 数据表/图形联动 → 假设—迭代」教学数据流 → `kernel/fit.ts`、`report/builder.ts`、`analysis` 面板 |
| [Kunz5/circuit-lab](https://github.com/Kunz5/circuit-lab) | 0 | **MIT** | 从方程出发的 MNA：部分主元 LU、Newton-Raphson + gmin stepping、C/L 后向欧拉 companion 模型、复数系统实嵌入、示波器 min/max 抽稀、把「列方程过程」讲给学生 → `kernel/circuit.ts`、`report` 推导说明 |
| [dmitry4287474/physviz-engine](https://github.com/dmitry4287474/physviz-engine) | 0 | **Apache-2.0** | 中学物理「电路节点分析 + 18 个交互实验 + 63 个测试」的组织方式与测试驱动思路 → `experiments/validate.ts`、`tests/` |
| [open-spaced-repetition/fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki) | 4127 | **MIT** | 记忆三变量（难度 D / 稳定性 S / 可提取性 R）与「按遗忘曲线排复习」的建模思路 → `learning/mastery.ts`（自研简化实现） |
| [Human-Centric-Machine-Learning/memorize](https://github.com/Human-Centric-Machine-Learning/memorize) | 190 | **MIT** | PNAS 间隔重复优化的目标函数（复习时刻由记忆强度决定）→ `learning/recommend.ts` 的优先级公式 |
| [alyssaxuu/carden](https://github.com/alyssaxuu/carden) | 491 | **MIT** | 卡片队列/毕业阈值/学习反馈闭环 → `learning/mistakes.ts` |
| [novasolver/physics-simulators](https://github.com/novasolver/physics-simulators) | 15 | **MIT** | 1600+ 教育工具按「参数—求解—可视化」统一模板批量产出 → DSL v2 的参数与求解器声明 |
| [ghwmelite-dotcom/AfriLab](https://github.com/ghwmelite-dotcom/AfriLab) | 2 | **MIT** | 29 个跨学科实验的学科分类/元数据组织 → `experiments/schema.ts` |
| [DavidWang1231/minispice](https://github.com/DavidWang1231/minispice) | 0 | **MIT** | 零依赖 MNA 求解引擎的边界处理 → `kernel/circuit.ts` |
| [pmndrs/cannon-es](https://github.com/pmndrs/cannon-es) | 2083 | **MIT** | 项目现有依赖，刚体积分与固定步长累加器 → 对照校验 `kernel/ode.ts` |
| [mrdoob/three.js](https://github.com/mrdoob/three.js) | 117671 | **MIT** | 项目现有依赖 |
| [liabru/matter-js](https://github.com/liabru/matter-js) | 18599 | **MIT** | 2D 约束求解/碰撞分类概念（未引入依赖） |
| [KaTeX/KaTeX](https://github.com/KaTeX/KaTeX) | 20502 | **MIT** | 公式渲染候选（V3 未引入，改自研 LaTeX 子集渲染器，避免包体膨胀） |
| [leeoniya/uPlot](https://github.com/leeoniya/uPlot) / [plotly/plotly.js](https://github.com/plotly/plotly.js) | 10619 / 18376 | **MIT** / **MIT** | 高性能时序绘制思路（min/max 抽稀）→ `ResearchLab` 曲线渲染 |
| [apache/echarts](https://github.com/apache/echarts) | 67689 | **Apache-2.0** | 图表能力候选（V3 未引入，保留自绘 SVG 以适配鸿蒙 WebView） |

### 2.2 强 / 弱 Copyleft —— 仅参考公开思想，禁止代码复用

| 项目 | 许可证 | 风险说明 | 本项目采取的动作 |
|---|---|---|---|
| [phetsims/*](https://github.com/phetsims)（如 `states-of-matter`、`pendulum-lab`） | **GPL-3.0**（仿真源码）；公共库 MIT；成品 HTML **CC BY 4.0**；PhET 名称/Logo 为商标 | 与闭源桌面/移动应用不兼容；GPL 要求衍生作品同许可证开源；商标不可用于宣传 | **只借鉴教学设计思想**（参数即时反馈、可测量仪器、探究式引导）。不复制源码、不嵌入 sim HTML、不使用 PhET 名称与 Logo、不在宣传中暗示关联 |
| [pfalstad/circuitjs1](https://github.com/pfalstad/circuitjs1) | **GPL-2.0**（`COPYING.txt` 已取证） | 强 copyleft | 仅参考「电路元件可视化 + 节点电压」概念；MNA 实现取自 MIT 项目思路并独立编写 |
| [ankitects/anki](https://github.com/ankitects/anki) | **AGPL-3.0-or-later**（含 BSD-3 / MIT 等混杂部分） | 网络条款 + 强 copyleft，最不适合嵌入 | 仅参考「间隔重复」这一公开算法概念；排程实现取自 MIT 的 FSRS 建模思想，自行实现 |
| [Xooter/Open-Microcosm](https://github.com/Xooter/Open-Microcosm) | **GPL-3.0** | 虚拟显微镜实验室，强 copyleft | 仅参考「可测量、可复现」的产品理念 |
| [teamzz111/GLV](https://github.com/teamzz111/GLV) | **GPL-3.0** | 3D 虚拟物理实验室，强 copyleft | 仅参考实验装配流程 |
| [aradzie/jecs](https://github.com/aradzie/jecs) | **AGPL-3.0** | 电路仿真，AGPL | 不接触实现 |
| [thm-projects/arsnova-flashcards](https://github.com/thm-projects/arsnova-flashcards) | **GPL-3.0** | 含 SM-2 / Leitner，强 copyleft | 不复用；SM-2 属公开算法，按公开数学定义独立实现 |
| [jsxgraph/jsxgraph](https://github.com/jsxgraph/jsxgraph) | **LGPL-3.0**（`LICENSE.LGPL` 已取证） | 弱 copyleft；静态打包进桌面/移动端仍易触发义务 | **不引入**，公式与图形改自研 SVG 渲染 |
| [opensourcephysics/osp](https://github.com/opensourcephysics/osp) | 官方为 GPL 系（API 返回 NOASSERTION） | 许可文件不归一 | 不复用 |

### 2.3 官方许可页交叉验证要点

- **PhET**（[官方 Software Agreement](https://phet-dev.colorado.edu/license.html)）：仿真专用源码 GPLv3；公共源码 MIT；单文件 HTML CC BY 4.0 且必须署名 "PhET Interactive Simulations, University of Colorado Boulder, https://phet.colorado.edu"；名称与 Logo 属商标，商用宣传需单独授权；"PhET Interoperable HTML Source Code" 完全不开源。
- **Anki**（官方 LICENSE / Debian copyright）：AGPL-3.0-or-later，桌面端；AGPL 第 13 条网络交互条款；内嵌组件许可混杂。
- **Scilab**（[官方 Wiki](https://wiki.scilab.org/License) / ATOMS TOU）：Scilab 6 起 GPL v2，亦可用 CeCILL；`scilab/scilab` 仓库 API 返回 NOASSERTION（多许可文件所致）。

---

## 3. 合规边界与本项目动作

### 3.1 判定前提
本项目 `pc/package.json` 为 `private: true`，交付形态是 Tauri 桌面程序与鸿蒙 HAP（WebView 内置 Web Bundle），**目前不是开源发行**。
因此：任何 GPL / AGPL / LGPL 代码进入前端 bundle 都会带来难以履行的源码提供与链接例外义务；V3 采取**最保守策略**。

### 3.2 V3 硬性规则（已落实到代码与文档）

1. **零新增运行时第三方依赖**：数值内核、表达式求值、校验器、检索、公式渲染、SHA-256、IndexedDB 封装全部自研纯 TypeScript；新增的仅 devDependency 为零（测试用 Node 内置 `node:test` + 已有 esbuild 打包）。
2. **只允许借鉴思想、算法与公开数学定义**：ODE 数值方法（RK4 / Dormand-Prince / Verlet）、最小二乘与 Levenberg–Marquardt、GUM 不确定度传播、FFT、MNA、BKT、SM-2、BM25 均为公开数学/算法知识，实现独立编写。
3. **不复制任何 GPL/AGPL/LGPL 项目的代码、资源、文案、图标、名称、Logo**；不嵌入 PhET 单文件 sim、不使用其商标。
4. **宽松许可项目**：本轮同样未复制代码，仅在 `THIRD_PARTY_NOTICES.md` 中列名致谢；若未来需要复用 MIT/Apache-2.0 片段，必须同时保留版权声明、许可证全文与 NOTICE，并在 `docs/` 记录来源文件与 commit。
5. **实验包来源可追溯**：DSL v2 新增 `attribution`（思想来源）与 `license`（包自身 SPDX）字段；所有内置实验包标注为本项目原创，参考来源仅作致谢。
6. **依赖清单留档**：`THIRD_PARTY_NOTICES.md` 列出全部直接与构建期依赖及其 SPDX 标识。

### 3.3 额外发现的名称合规风险 ⚠️

> 项目内部代号 **"SciLab"** 与 Dassault Systèmes（原 ESI Group / Inria）旗下的数值计算软件 **Scilab** 高度近似，后者为 GPL v2 / CeCILL 许可的知名开源产品，且 "SCILAB" 作为产品名称在 ATOMS 条款中被明确使用与保护。
> 本项目与之无任何代码或组织关联，但 `pc/package.json` 的 `"name": "scilab-pc"`、`docs/` 与 UI 中的并列品名「智实验 SciLab」，在公开发布/上架时存在**商标混淆与来源误认**风险。
> **建议（本报告不擅自改名）**：对外统一使用中文主品牌「智实验」，英文副名改为可区分的自有标识（例如 `SciLabX / ZhiLab / SciLab-edu` 需先做商标检索），并在 README 增加「与 Scilab 数值计算软件无关联」的声明。V3 已在 README 中加入该声明。

---

## 4. 结论

- 调研覆盖 **57** 个候选仓库、**29** 个精确核查、**23** 份许可证全文取证，并对 4 个 NOASSERTION 项目做了官方许可页交叉验证。
- 可安全借鉴的高价值参考共 **10+ 个**（myPhysicsLab / CODAP / Circuit Lab / physviz-engine / FSRS / memorize / Carden / NovaSolver / AfriLab / miniSPICE 等），覆盖数值求解、数据分析、电路方程、学习科学、实验包组织五大方向。
- 所有强/弱 copyleft 项目均划入「只读思想」区，V3 以自研内核落地，**不产生任何新的许可证义务**。
- 需用户决策的唯一事项：产品英文名与 "Scilab" 的区隔（见 §3.3）。
