# 第三方软件声明（Third-Party Notices）

> 生成日期：2026-11-06 · 适用范围：智实验 / ScienceExperiment 仓库（PC 主线 + 鸿蒙副线）
> 本文件记录**实际进入构建产物**的依赖，以及**仅作思路参考、未复用代码**的开源项目。
> 本文件不构成法律意见；许可证全文以各项目仓库 / `node_modules/<pkg>/LICENSE*` 为准。

---

## 1. 运行时直接依赖（`pc/package.json > dependencies`）

| 包 | 版本 | SPDX | 用途 | 许可证文件 |
|---|---|---|---|---|
| `vue` | 3.5.44 | MIT | 前端框架 | `pc/node_modules/vue/LICENSE` |
| `three` | 0.186.1 | MIT | 3D 渲染 | `pc/node_modules/three/LICENSE` |
| `cannon-es` | 0.20.0 | MIT | 刚体物理 | `pc/node_modules/cannon-es/LICENSE` |
| `@tauri-apps/api` | 2.12.3 | Apache-2.0 OR MIT | 桌面壳 JS API | `pc/node_modules/@tauri-apps/api/LICENSE` |

> 上述 MIT / Apache-2.0 依赖在分发二进制时须保留版权声明与许可证文本；本文件与 `node_modules` 内 LICENSE 一并作为随附材料。

## 2. 构建期依赖（`devDependencies` 与传递使用）

| 包 | 版本 | SPDX | 用途 |
|---|---|---|---|
| `vite` | 5.4.21 | MIT | 构建工具 |
| `@vitejs/plugin-vue` | 5.2.4 | MIT | Vue SFC 编译 |
| `typescript` | 5.9.3 | Apache-2.0 | 类型检查 |
| `@tauri-apps/cli` | 2.12.2 | Apache-2.0 OR MIT | Tauri 打包 CLI |
| `esbuild` | 0.21.5 | MIT | Vite 传递依赖；也被 `pc/scripts/run-tests.mjs` 用于打包测试 |

**测试框架**：Node.js 内置 `node:test` + `node:assert/strict`（Node 22），无 vitest/jest，无新增许可证义务。

## 3. Rust 侧依赖（`pc/src-tauri/Cargo.toml`）

| crate | SPDX（以上游 Cargo.toml 为准） | 用途 |
|---|---|---|
| `tauri` / `tauri-build` | MIT OR Apache-2.0 | 桌面应用框架 |
| `tauri-plugin-opener` | MIT OR Apache-2.0 | 打开外部链接 |
| `serde` / `serde_json` | MIT OR Apache-2.0 | 序列化 |

## 4. 仓库内随附的第三方资源

| 路径 | 内容 | 许可证 |
|---|---|---|
| `entry/src/main/resources/rawfile/web/engine/three.min.js` | three.js 旧版构建副本 | MIT（版权归 three.js authors） |
| `pc/public/engine/` | 旧版 JS 引擎副本（含 `three.min.js`） | MIT |
| `pc/src/assets/app-icon.png` / `docs/现代扁平风格应用图标…png` | 项目图标 | 本项目自绘/生成 |

> 这些副本为历史构建链遗留；若清理，请确认鸿蒙 WebView 不再引用后再删除。

---

## 5. 仅作思路参考、未复用代码的开源项目

调研与许可证取证详情见 [`docs/GitHub开源项目调研与合规报告.md`](./docs/GitHub开源项目调研与合规报告.md)。下列项目**没有任何代码、资源、名称或商标进入本仓库**；仅参考公开的工程思想、算法定义与教学设计。

### 5.1 宽松许可（MIT / Apache-2.0 / Zlib）— 思路致谢

| 项目 | SPDX | 参考内容 |
|---|---|---|
| myphysicslab/myphysicslab | Apache-2.0 | 求解器分层、自适应步长、能量系统抽象 |
| Concord-Consortium/codap | MIT | 仿真数据 → 案例表 → 建模的教学数据流 |
| Kunz5/circuit-lab | MIT | MNA stamping、部分主元 LU、companion 模型、min/max 抽稀 |
| dmitry4287474/physviz-engine | Apache-2.0 | 电路节点分析与测试组织 |
| open-spaced-repetition/fsrs4anki | MIT | 记忆 D/S/R 建模思想 |
| Human-Centric-Machine-Learning/memorize | MIT | 复习时刻优化目标 |
| alyssaxuu/carden | MIT | 卡片毕业与反馈闭环 |
| novasolver/physics-simulators | MIT | 实验包模板化组织 |
| ghwmelite-dotcom/AfriLab | MIT | 跨学科实验元数据 |
| DavidWang1231/minispice | MIT | 零依赖 MNA 边界处理 |
| KaTeX/KaTeX、leeoniya/uPlot、plotly/plotly.js、apache/echarts | MIT / Apache-2.0 | 公式与图表渲染候选（**未引入**） |
| liabru/matter-js、pmndrs/cannon-es、mrdoob/three.js | MIT | 物理/渲染概念对照 |

### 5.2 强 / 弱 Copyleft — 只读思想，零复用

| 项目 | SPDX | 约束与本项目动作 |
|---|---|---|
| PhET Interactive Simulations（`phetsims/*`） | 仿真源码 GPL-3.0；公共库 MIT；成品 HTML CC BY 4.0；名称/Logo 为商标 | 不复制源码、不嵌入 sim HTML、不使用其名称与商标做宣传；仅参考探究式教学理念 |
| pfalstad/circuitjs1 | GPL-2.0 | 仅参考电路可视化概念 |
| ankitects/anki | AGPL-3.0-or-later（含混杂许可） | 仅参考「间隔重复」概念 |
| jsxgraph/jsxgraph | LGPL-3.0 | 不引入，公式/图形改自研 SVG 渲染 |
| Xooter/Open-Microcosm、teamzz111/GLV、thm-projects/arsnova-flashcards | GPL-3.0 | 不复用 |
| aradzie/jecs | AGPL-3.0 | 不接触实现 |
| opensourcephysics/osp | GPL 系（API 返回 NOASSERTION） | 不复用 |
| scilab/scilab | GPL-2.0 / CeCILL（名称属第三方产品） | 无代码关联；名称混淆风险见 README §5 |

---

## 6. 合规操作清单

1. 未来若要复用 MIT / Apache-2.0 项目代码片段：保留原版权声明、许可证全文，新增 `NOTICE` 条目，并在 `docs/` 记录来源文件与 commit。
2. 任何 GPL / AGPL / LGPL 代码、资源、图标不得进入 `pc/src`、`pc/experiments` 或鸿蒙 `rawfile/web` 产物。
3. 新增 npm 依赖前先核查 SPDX；打包分发时重新生成本文件第 1–3 节。
4. 公开发布前：为项目本体选定许可证；处理 §5.2 的 Scilab 名称区分问题。
