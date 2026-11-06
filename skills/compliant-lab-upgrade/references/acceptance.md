# 验收清单与数值算法常见坑

## 验收命令链

```bash
npm run typecheck                 # tsc --noEmit，零错误
npm test                          # node --test，全部通过
node scripts/package_check.mjs --dir ./experiments
npm run build                     # 主线生产构建
npx vite build --config vite.hos.config.ts   # 副线（如有）
python scripts/inline_hos.py <输出目录>       # 副线单文件内联（如有）
node scripts/validate_skill.mjs . # 技能包自检（如打包本技能）
```

全部通过后再提交。CI 中的 DSL 体检步骤**不要加 `|| exit 0`**，否则等于没校验。

## 零新增依赖的测试链

```
tests/*.test.ts ──esbuild(bundle, platform=node, format=esm)──> 临时目录/*.mjs ──node --test──> TAP
```

- 复用构建期已有的 esbuild，不引入 jest / vitest。
- 测试运行器负责打包、调用 `node --test`、透传退出码、清理临时目录。
- `tsc --noEmit` 报 `Cannot find module '*.vue'` 时，加 `src/env.d.ts` 声明 `*.vue` 模块。

## 数值算法坑（按踩坑概率排序）

### 1. RK45 系数抄错 → 全程 NaN

Dormand-Prince 的 5 阶解系数是独立的 `b5`，**不是** Butcher 表最后一行的阶段系数 `a[6]`：

```ts
const b5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0]
```

症状：第一步正常，第二步起全 NaN。排查时在自适应步长循环里打印每步 `t / h / y`。

### 2. 物理常量遮蔽变量

表达式里 `R`（气体常数）、`g`（重力）、`c`（光速）若做成硬编码常量，用户传同名参数会被遮蔽，结果差好几个数量级。

**正确做法**：常量作为「可被变量覆盖的默认值」——先查变量表，找不到再回退常量；且 `collectVariables` 不把常量算作必须输入。

### 3. 辛格式能量漂移阈值设太严

辛 Euler / Verlet 的能量误差是 **O(h) 有界振荡**，不是单调收敛；显式 Euler 才是单调发散。断言应写成「辛/Verlet 的漂移显著小于 Euler」（如 `< 0.1` / `< 1e-3` 量级），不要照抄 RK4 的 `1e-10`。

### 4. 非线性拟合条件数维度

雅可比 `J` 是 m×n 非方阵，直接 `conditionNumber(J)` 没有意义。应对 Gauss-Newton 正规矩阵 `JᵀJ` 求条件数。

### 5. 完美拟合的置信区间

无噪声数据时残差为 0，CI 退化为点估计。单测别断言「CI 覆盖真值区间」这种空区间；要另写一个**带噪声**的用例验证 CI 覆盖真值（如 `R² > 0.998`）。

### 6. 大样本 `Math.min(...arr)` 爆栈

蒙特卡洛传播 1 万+ 样本时展开参数可能触发栈限制。改成循环求 min/max。

### 7. AC 扫频 `ω = 0` 除零

电感交流导纳 `1/(ωL)` 在直流点为 `-Infinity`。`ω === 0` 时用大导纳（如 `1e9`）近似短路。

### 8. 快照校验和 JSON 往返不一致

内存对象含 `undefined` 字段，序列化后字段消失，再算校验和就对不上。

```ts
const clean = JSON.parse(JSON.stringify(snapshot))
const { checksum, id, ...rest } = clean
```

**先归一化再剔除** `checksum` / `id`，顺序不能反。

### 9. 错题收集字段映射

题库字段常叫 `q`，错题卡内部叫 `question`。`{ ...answer, experimentId }` 直接展开会让 `hashString(undefined)` 报错。必须显式映射。

### 10. 块注释里的 `*/`

注释写 `experiments/*/scene.json` 会让 `*/` 提前闭合块注释，后面的中文被当代码解析，报 `SyntaxError: Unexpected identifier`。写 `experiments/<id>/scene.json`。

## 测试设计建议

按「解析解可对照」组织，每个内核模块至少 5 个用例：

| 模块 | 黄金参照 |
|---|---|
| LU / Cholesky | 手算 3×3 解、跨 1e8 量级矩阵 |
| RK4 / RK45 | `y = e^-t` 解析解、谐振子能量 |
| FFT | 已知频率正弦（如 5 Hz / 64 Hz 采样）主频检测 |
| GUM / MC | 乘积模型相对不确定度、线性模型两者一致 |
| 电路 | 分压、RC 充电 `5(1-e^(-t/RC))`、RC 低通截止增益 `1/√2` |
| SHA-256 | 标准测试向量（空串、`abc`） |
| DSL | 全部内置包零 error、残缺包被拒、导入→导出→卸载闭环 |
| 快照 | 篡改检测、序列化往返、数值复跑逐点比对 |

## 构建验收要点

- 主线构建产物记录 chunk 体积，异常膨胀要排查（是否误把测试代码打进产物）。
- 副线构建必须 IIFE + `inlineDynamicImports`，产出单文件；内联脚本要删除 `assets/` 并确认最终体积。
- 鸿蒙 / WebView 场景：`crypto.subtle`、`fetch`、Web Worker、动态 import 都不可靠，内核不得依赖。

## Git 同步（分叉处置）

推送被 `fetch first` 拒绝时，**先判断是不是 API 兜底推送造成的 SHA 分叉**：

```bash
git fetch origin main
git log --oneline origin/main
git merge-base main origin/main
git rev-list --left-right --count main...origin/main
git rev-parse <本地提交>^{tree}
git rev-parse <对应远端提交>^{tree}
git diff --stat <本地r7> <远端r7>
```

- 若成对提交的 `tree` 完全一致、diff 为空 → 只是 SHA 不同，本地是内容超集，可以对齐。
- 对齐必须用 `git push --force-with-lease=<branch>:<远端SHA> origin <branch>`，**明确锁定远端期望 SHA**，绝不裸 `--force`。
- 若 tree 不一致，说明远端有真实新工作，先 `rebase` / `merge`，不要覆盖。
- 推送后验证：`git rev-parse main` 与 `git ls-remote origin refs/heads/main` 一致。
