# 智实验 · 理科 3D 虚拟实验室（V3）

面向中学与大学基础实验教学的**离线优先**虚拟实验室：27 个实验包、3D 交互场景、虚拟仪器、考核与题库、AI 诊断，以及 V3 新增的科学计算内核与学习科学闭环。

> **开发主线**：`pc/`（Vue 3 + Vite + TypeScript + Tauri 2）为唯一功能主线；`entry/`（HarmonyOS ArkTS + WebView）为副线，通过 `vite.hos.config.ts` 重建 Web Bundle 跟随，不重复开发功能。

---

## 1. V3 新增能力（2026-11-06）

| 层次 | 能力 | 主要模块 |
|---|---|---|
| 科学计算内核 | 部分主元 LU / Cholesky、条件数；Euler / 辛 Euler / Verlet / RK4 / RK45 自适应 + 零交叉事件 + 能量守恒诊断；安全表达式求值器（无 eval）；SI 量纲校验；WLS / 多项式 / Levenberg–Marquardt 拟合 + 置信区间 + AIC/BIC；GUM / 蒙特卡洛不确定度、FFT 频谱、Welch t 检验；电路 MNA + 瞬态 + AC 扫频 | `pc/src/kernel/`（9 个纯 TS 模块，零第三方依赖） |
| 实验包 DSL v2 | manifest 元数据、SPDX 许可证与思想来源、数值求解器/分析方法声明、自研 JSON-Schema 校验器、运行时导入/导出/版本迁移、校验和；导入包可用声明式 ODE 直接运行 | `pc/src/experiments/schema.ts` `validate.ts` `packages.ts` `logic/generic.ts` |
| 学习闭环 | IndexedDB 持久层（自动降级）、多档案、BKT 掌握度 + D/S/R 遗忘曲线排程、错题本与间隔重复、学习路径推荐（接通 V2 死代码） | `pc/src/learning/` |
| 可复现性与报告 | 纯 TS SHA-256、实验快照 v3（导出/导入/校验/逐点复跑比对）、报告 3.0（Markdown / 自包含 HTML+SVG / CSV） | `pc/src/learning/snapshot.ts` `pc/src/report/` |
| 助教 2.0 | BM25 离线检索（中文二元字 gram）、LaTeX 子集渲染、数据诊断规则、可插拔大模型适配器 | `pc/src/assistant/` |
| 界面 | 数值研究台、学习中心、实验台「数据分析 / 保存快照 / 报告 3.0」、薄弱实验推荐条 | `pc/src/components/ResearchLab.vue` `LearningCenter.vue` `ExperimentStage.vue` `App.vue` |
| 工程化 | `typecheck` / `test`（esbuild + Node 内置 `node:test`，零新依赖）/ CI / README / 第三方声明 / 合规调研报告 | `pc/scripts/run-tests.mjs` `.github/workflows/ci.yml` `docs/` |

**验证结果**：`npx tsc --noEmit` 零错误；`npm test` 59 项测试全通过；`npm run build`（PC）与 `npx vite build --config vite.hos.config.ts`（鸿蒙）均成功。

---

## 2. 目录结构

```
pc/
├── src/
│   ├── kernel/          科学计算内核（平台无关，PC 与鸿蒙共用）
│   ├── engine/          3D 渲染 / 刚体 / 电路 / 化学特效 / 统计噪声
│   ├── experiments/     DSL v2、校验器、注册中心、27 个逻辑实现
│   ├── learning/        持久化、掌握度、错题本、推荐器、快照
│   ├── report/          SHA-256、报告构建与导出
│   ├── assistant/       BM25 检索、公式渲染、助教引擎
│   ├── components/      实验台、数值研究台、学习中心等视图
│   ├── store/ data/     V2 兼容的本地进度与元数据
│   ├── hos/             鸿蒙 WebView 入口
│   └── App.vue          PC 主界面
├── experiments/         27 个实验包（scene.json + 可选 quiz.json）
├── scripts/             run-tests.mjs / inline_hos.py / inline_hos.ps1
├── src-tauri/           Tauri 2 Rust 壳
└── tests/               59 项单元测试
entry/                   HarmonyOS ArkTS 壳 + rawfile/web/hos.html（构建产物）
docs/                    总体方案、升级方案 V2/V3、GitHub 开源项目调研与合规报告
```

---

## 3. 快速开始

```bash
# PC 开发（端口 5180）
cd pc && npm install && npm run dev

# 质量检查与构建
npm run typecheck       # tsc --noEmit
npm test                # esbuild 打包 TS 测试 + node --test
npm run build           # PC 生产构建 → pc/dist
npm run tauri build     # Windows 桌面安装包（NSIS）

# 鸿蒙 Web Bundle（副线跟随）
cd pc
npx vite build --config vite.hos.config.ts
cd ..
python pc/scripts/inline_hos.py entry/src/main/resources/rawfile/web
# 产物：单文件 entry/src/main/resources/rawfile/web/hos.html
```

> 鸿蒙 WebView 通过 `resource://` 加载（opaque origin），因此构建产物必须是 **IIFE + 全内联单文件**；`inline_hos.py` 会把 JS/CSS 内联并把入口脚本移到 `</body>` 前。

---

## 4. 实验包 DSL v2

每个 `pc/experiments/<id>/scene.json` 现携带：

```jsonc
{
  "id": "physics.pendulum",
  "title": "单摆测重力加速度",
  "meta": {
    "dslVersion": "2.0.0",
    "license": "Proprietary",
    "authors": ["智实验项目组"],
    "attribution": [ /* 思想来源 + SPDX + 说明 */ ]
  },
  "solver": {
    "kind": "ode", "solver": "rk45", "dt": 0.01, "tEnd": 10,
    "equations": ["omega", "-(gravity/length)*sin(theta)"],
    "stateNames": ["theta", "omega"], "paramNames": ["length", "gravity"],
    "initial": [0.2618, 0], "energy": "..."
  },
  "analysis": { "fit": { "model": "linear" }, "uncertainty": { /* ... */ } }
}
```

- 所有 V2 字段保持兼容；`solver.equations` 用安全表达式（无 `eval`）声明状态方程，导入的实验包无需 TypeScript 逻辑即可运行。
- 导入格式见 `pc/src/experiments/packages.ts` 的 `PACKAGE_FORMAT`；学习中心提供导入/导出与逐字段校验报告。
- 快照格式见 `scilab.snapshot.v3`，包含参数、种子、求解器、数据、拟合结果与 SHA-256，可复跑比对。

---

## 5. 开源合规声明

本项目 `pc/package.json` 为 `private: true`，**当前未声明对外开源许可证**；如需开源发行，请先由权利人选定许可证（建议 MIT / Apache-2.0）并补充 `LICENSE` 文件。

- **零新增运行时第三方依赖**：V3 全部新模块为本项目独立编写的纯 TypeScript。
- 依赖清单与许可证全文位置见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
- 调研过的相似项目、许可证取证与法律边界见 [`docs/GitHub开源项目调研与合规报告.md`](./docs/GitHub开源项目调研与合规报告.md)。核心结论：**GPL / AGPL / LGPL 项目（PhET、CircuitJS1、Anki、JSXGraph 等）仅参考公开思想，未复制任何代码、资源、名称或商标**；MIT / Apache-2.0 项目仅作思路致谢，未复制代码。
- ⚠️ **名称区分**：本项目中文主品牌为「智实验」。内部英文代号 `SciLab` 与 Dassault Systèmes 旗下数值计算软件 **Scilab**（GPL v2 / CeCILL）无任何关联；公开发布/上架前建议改用可区分的英文标识，避免商标混淆与来源误认。

---

## 6. 路线状态

| 阶段 | 状态 |
|---|---|
| V1–V2（27 个实验、3D 引擎、虚拟仪器、对照实验、考核、题库、诊断、参数扫描） | 已完成 |
| V3（科学计算内核、DSL v2、学习科学闭环、报告 3.0、助教 2.0、工程化） | 已完成（本轮） |
| 后续候选 | 多用户/教师端与班级任务、端侧大模型适配器实装、实验包市场、鸿蒙原生 3D 渲染评估 |
