<script setup lang="ts">
/**
 * V3 数值研究台：把科学计算内核直接暴露为可交互实验环境。
 * 支持求解器切换、自适应步长、能量守恒诊断、拟合、频谱、不确定度与可复现快照。
 */
import { ref, computed, reactive } from 'vue'
import { integrate, compareSolvers, type Derivative, type SolverKind, type Trajectory } from '../kernel/ode'
import { compileSystem, evaluate } from '../kernel/expr'
import { linearFit, polynomialFit, nonlinearFit, type FitResult } from '../kernel/fit'
import { propagateUncertainty, monteCarloUncertainty, dominantFrequency, powerSpectrum } from '../kernel/stats'
import { svgLineChart } from '../report/export'
import { buildReport } from '../report/builder'
import { toMarkdown, toHTML, downloadFile } from '../report/export'
import { createSnapshot, parseSnapshot, replaySnapshot, type ExperimentSnapshot } from '../learning/snapshot'
import { labDB } from '../learning/db'

interface PresetParam { id: string; label: string; min: number; max: number; step: number; value: number; unit?: string }
interface Preset {
  id: string
  title: string
  description: string
  equations: string[]
  stateNames: string[]
  paramNames: string[]
  initial: number[]
  params: PresetParam[]
  energy: string
  solver: SolverKind
  dt: number
  tEnd: number
  note: string
}

const PRESETS: Preset[] = [
  {
    id: 'pendulum', title: '非线性单摆', description: '不做小角度近似：θ″ = −(g/L)·sinθ',
    equations: ['omega', '-(g/L)*sin(theta)'], stateNames: ['theta', 'omega'], paramNames: ['g', 'L'],
    initial: [0.8, 0], params: [
      { id: 'L', label: '摆长 L', min: 0.2, max: 3, step: 0.05, value: 1, unit: 'm' },
      { id: 'g', label: '重力加速度 g', min: 1.6, max: 24.8, step: 0.1, value: 9.8, unit: 'm/s²' }
    ],
    energy: '0.5*L^2*omega^2 + g*L*(1-cos(theta))', solver: 'rk45', dt: 0.02, tEnd: 12,
    note: '大角度下周期明显长于 2π√(L/g)；能量守恒可用于检验求解器质量。'
  },
  {
    id: 'damped', title: '阻尼弹簧振子', description: 'm·x″ = −kx − cv，能量单调耗散',
    equations: ['v', '-(k/m)*x - (c/m)*v'], stateNames: ['x', 'v'], paramNames: ['k', 'm', 'c'],
    initial: [1, 0], params: [
      { id: 'k', label: '劲度系数 k', min: 1, max: 60, step: 1, value: 20, unit: 'N/m' },
      { id: 'm', label: '质量 m', min: 0.2, max: 5, step: 0.1, value: 1, unit: 'kg' },
      { id: 'c', label: '阻尼 c', min: 0, max: 5, step: 0.1, value: 0.4, unit: 'N·s/m' }
    ],
    energy: '0.5*m*v^2 + 0.5*k*x^2', solver: 'rk4', dt: 0.01, tEnd: 10,
    note: '有阻尼系统能量不守恒，诊断值代表耗散量而非数值误差。'
  },
  {
    id: 'oscillator', title: '无阻尼简谐振子', description: 'x″ = −ω²x，用于对比辛积分与显式欧拉',
    equations: ['v', '-k*x'], stateNames: ['x', 'v'], paramNames: ['k'],
    initial: [1, 0], params: [{ id: 'k', label: 'k', min: 0.5, max: 20, step: 0.5, value: 4 }],
    energy: '0.5*v^2 + 0.5*k*x^2', solver: 'verlet', dt: 0.02, tEnd: 20,
    note: '同一模型下对比 5 种求解器：显式欧拉能量发散，辛/Verlet 有界，RK4/RK45 高精度。'
  },
  {
    id: 'freefall', title: '自由落体（含二次阻力）', description: 'y″ = −g + (c/m)·v²',
    equations: ['v', '-g + (c/m)*v^2'], stateNames: ['y', 'v'], paramNames: ['g', 'c', 'm'],
    initial: [100, 0], params: [
      { id: 'g', label: 'g', min: 1.6, max: 20, step: 0.1, value: 9.8, unit: 'm/s²' },
      { id: 'c', label: '阻力系数 c', min: 0, max: 0.5, step: 0.01, value: 0.05 },
      { id: 'm', label: '质量 m', min: 0.5, max: 10, step: 0.5, value: 2, unit: 'kg' }
    ],
    energy: '', solver: 'rk45', dt: 0.02, tEnd: 6,
    note: '速度趋于终端速度；无解析闭式解，适合观察自适应步长的作用。'
  }
]

const presetId = ref('pendulum')
const preset = computed(() => PRESETS.find((p) => p.id === presetId.value)!)
const solver = ref<SolverKind>('rk45')
const dt = ref(0.02)
const tEnd = ref(12)
const rtol = ref(1e-8)
const paramValues = reactive<Record<string, number>>({})
const traj = ref<Trajectory | null>(null)
const comparison = ref<Array<{ solver: SolverKind; finalDrift: number; maxDrift: number; steps: number; rejected: number }>>([])
const fitResult = ref<FitResult | null>(null)
const fitKind = ref<'none' | 'linear' | 'poly2' | 'exponential'>('none')
const spectrumText = ref('')
const gumText = ref('')
const message = ref('')
const showTable = ref(false)

function syncParams(): void {
  for (const key of Object.keys(paramValues)) delete paramValues[key]
  for (const p of preset.value.params) paramValues[p.id] = p.value
}
function selectPreset(): void {
  syncParams()
  solver.value = preset.value.solver
  dt.value = preset.value.dt
  tEnd.value = preset.value.tEnd
  traj.value = null
  comparison.value = []
  fitResult.value = null
  spectrumText.value = ''
  gumText.value = ''
  message.value = ''
}
syncParams()

function buildDerivative(p: Preset): Derivative {
  const sys = compileSystem(p.equations, p.stateNames, p.paramNames)
  return (t, y) => sys.derivative(t, y, { ...paramValues, t })
}

function buildEnergy(p: Preset): ((t: number, y: number[]) => number) | undefined {
  if (!p.energy) return undefined
  return (t, y) => {
    const vars: Record<string, number> = { ...paramValues, t }
    p.stateNames.forEach((n, i) => { vars[n] = y[i] })
    return evaluate(p.energy, vars)
  }
}

function run(): void {
  const p = preset.value
  try {
    const trajectory = integrate(buildDerivative(p), p.initial.slice(), 0, tEnd.value, {
      solver: solver.value, dt: dt.value, rtol: rtol.value, atol: rtol.value * 1e-3,
      energy: buildEnergy(p), maxPoints: 6000
    })
    traj.value = trajectory
    fitResult.value = null
    spectrumText.value = ''
    gumText.value = ''
    message.value = `已使用 ${solver.value} 求解：${trajectory.diagnostics.steps} 步，拒绝步 ${trajectory.diagnostics.rejected}。`
  } catch (e) {
    message.value = `求解失败：${e instanceof Error ? e.message : String(e)}`
  }
}

const rows = computed<number[][]>(() => traj.value?.points.map((pt) => [pt.t, ...pt.y]) ?? [])
const chart = computed(() => svgLineChart(rows.value, 0, 1, { title: `${preset.value.title} · ${preset.value.stateNames[0]}(t)` }))
const diagnosticsText = computed(() => {
  const d = traj.value?.diagnostics
  if (!d) return ''
  return `步数 ${d.steps} · 拒绝 ${d.rejected} · 步长 ${d.minDt.toPrecision(3)}–${d.maxDt.toPrecision(3)} s · 最大能量漂移 ${d.maxEnergyDrift.toExponential(3)}${d.truncated ? ' · 采样点已截断' : ''}`
})

function runComparison(): void {
  const p = preset.value
  if (!p.energy) { message.value = '该模型无守恒量，跳过求解器对比。'; return }
  comparison.value = compareSolvers(buildDerivative(p), p.initial.slice(), 0, Math.min(tEnd.value, 20), dt.value, buildEnergy(p)!)
  message.value = '已对比 5 种求解器的能量漂移（越小越好）。'
}

function runFit(): void {
  const data = rows.value
  if (data.length < 4) { message.value = '数据点不足，无法拟合。'; return }
  const x = data.map((r) => r[0])
  const y = data.map((r) => r[1])
  try {
    if (fitKind.value === 'linear') fitResult.value = linearFit(x, y)
    else if (fitKind.value === 'poly2') fitResult.value = polynomialFit(x, y, 2)
    else if (fitKind.value === 'exponential') fitResult.value = nonlinearFit((t, pp) => pp[0] * Math.exp(-pp[1] * t) + pp[2], x, y, [y[0], 0.5, 0])
    else fitResult.value = null
    message.value = fitResult.value ? '拟合完成，结果见下方。' : '请选择拟合模型。'
  } catch (e) {
    message.value = `拟合失败：${e instanceof Error ? e.message : String(e)}`
  }
}

function runSpectrum(): void {
  const y = rows.value.map((r) => r[1])
  if (y.length < 16) { message.value = '频谱分析至少需要 16 个采样点。'; return }
  const fs = 1 / Math.max(1e-9, dt.value)
  const dom = dominantFrequency(y, fs)
  const sp = powerSpectrum(y, fs)
  spectrumText.value = dom
    ? `主频 ${dom.freq.toPrecision(5)} Hz（周期 ${dom.period.toPrecision(5)} s，幅值 ${dom.amplitude.toPrecision(4)}）· 单边谱 ${sp.freq.length} 个频点`
    : '未检测到显著主频。'
  message.value = '频谱分析完成。'
}

function runUncertainty(): void {
  const p = preset.value
  // 以摆动周期 T = 2π√(L/g) 为例做 GUM + 蒙特卡洛双路径校验
  const f = (q: number[]) => 2 * Math.PI * Math.sqrt(q[0] / q[1])
  const L = paramValues.L ?? 1
  const g = paramValues.g ?? 9.8
  const gum = propagateUncertainty(f, [L, g], [0.002, 0.05])
  const mc = monteCarloUncertainty(f, [L, g], [0.002, 0.05], presetId.value, 5000)
  gumText.value = `T = 2π√(L/g) → ${gum.value.toFixed(5)} ± ${gum.sigma.toFixed(5)} s（GUM，相对 ${(gum.relative * 100).toFixed(2)}%）；蒙特卡洛 ${mc.mean.toFixed(5)} ± ${mc.sd.toFixed(5)} s，95% 区间 [${mc.ci95[0].toFixed(5)}, ${mc.ci95[1].toFixed(5)}]。`
  message.value = `不确定度评定完成（模型 ${p.title}）。`
}

function snapshotOfCurrent(): ExperimentSnapshot | null {
  if (!traj.value) return null
  const p = preset.value
  return createSnapshot({
    experimentId: `research.${p.id}`,
    title: `${p.title} · 数值研究`,
    params: { ...paramValues },
    rows: rows.value,
    resultLines: [diagnosticsText.value, spectrumText.value, gumText.value].filter(Boolean),
    solver: {
      kind: 'ode', solver: solver.value, dt: dt.value, rtol: rtol.value, tEnd: tEnd.value,
      equations: p.equations, stateNames: p.stateNames, paramNames: p.paramNames,
      initial: p.initial, energy: p.energy || undefined
    },
    seed: `research.${p.id}`,
    fit: fitResult.value ? { label: fitResult.value.label, params: fitResult.value.params, r2: fitResult.value.r2 } : undefined,
    energyDrift: traj.value.diagnostics.maxEnergyDrift,
    source: 'research'
  })
}

async function saveSnapshot(): Promise<void> {
  const s = snapshotOfCurrent()
  if (!s) { message.value = '请先运行求解。'; return }
  await labDB.put('snapshots', s)
  downloadFile(`snapshot-${preset.value.id}.json`, JSON.stringify({ format: 'scilab.snapshot.v3', snapshot: s }, null, 2), 'application/json')
  message.value = `快照已保存并下载：${s.id}（SHA-256 ${s.checksum.slice(0, 12)}…）`
}

function exportCurrent(format: 'markdown' | 'html'): void {
  const s = snapshotOfCurrent()
  const report = buildReport({
    experimentId: `research.${preset.value.id}`,
    title: `${preset.value.title} · 数值研究`,
    guide: preset.value.description,
    params: { ...paramValues },
    rows: rows.value,
    headers: ['t', ...preset.value.stateNames],
    resultLines: [preset.value.note, diagnosticsText.value].filter(Boolean),
    fit: fitResult.value,
    dominantFrequency: null,
    snapshot: s,
    solverNotes: [`求解器 ${solver.value}，步长 ${dt.value}，相对容差 ${rtol.value}。`, comparison.value.length ? `求解器对比：${comparison.value.map((c) => `${c.solver} ${c.finalDrift.toExponential(2)}`).join('，')}` : ''].filter(Boolean)
  })
  const content = format === 'html' ? toHTML(report) : toMarkdown(report)
  downloadFile(`report-${preset.value.id}.${format === 'html' ? 'html' : 'md'}`, content, format === 'html' ? 'text/html' : 'text/markdown')
  message.value = `报告 3.0 已导出（${format === 'html' ? 'HTML' : 'Markdown'}）。`
}

function importSnapshotText(text: string): void {
  const r = parseSnapshot(text)
  if (!r.ok || !r.snapshot) { message.value = `导入失败：${r.error}`; return }
  const replay = replaySnapshot(r.snapshot)
  message.value = replay.ok
    ? `快照校验通过；复跑 ${replay.compared} 点，最大偏差 ${replay.maxAbsDiff.toExponential(3)}，${replay.matches ? '结果一致 ✓' : '存在差异 ✗'}`
    : `快照校验通过，但无法复跑：${replay.reason}`
}
defineExpose({ importSnapshotText })
</script>

<template>
  <div class="research">
    <header class="head">
      <div>
        <h1>数值研究台 <span class="badge">V3 内核</span></h1>
        <p class="sub">ODE 求解器 · 能量守恒诊断 · 最小二乘拟合 · 频谱 · GUM / 蒙特卡洛不确定度 · 可复现快照</p>
      </div>
    </header>

    <div class="grid">
      <section class="panel controls">
        <h2>实验模型</h2>
        <label class="field"><span>模型</span>
          <select v-model="presetId" @change="selectPreset">
            <option v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.title }}</option>
          </select>
        </label>
        <p class="note">{{ preset.description }}</p>

        <h2>求解设置</h2>
        <label class="field"><span>求解器</span>
          <select v-model="solver">
            <option value="euler">显式 Euler</option>
            <option value="symplectic">辛 Euler</option>
            <option value="verlet">Velocity Verlet</option>
            <option value="rk4">RK4</option>
            <option value="rk45">RK45 自适应</option>
          </select>
        </label>
        <label class="field"><span>步长 dt (s)</span><input v-model.number="dt" type="number" min="0.0001" step="0.005" /></label>
        <label class="field"><span>终止时间 (s)</span><input v-model.number="tEnd" type="number" min="0.1" step="1" /></label>
        <label class="field"><span>自适应容差</span><input v-model.number="rtol" type="number" min="1e-12" step="1e-8" /></label>

        <h2>模型参数</h2>
        <label v-for="p in preset.params" :key="p.id" class="field slider">
          <span>{{ p.label }} <b>{{ paramValues[p.id] }}</b> {{ p.unit }}</span>
          <input v-model.number="paramValues[p.id]" type="range" :min="p.min" :max="p.max" :step="p.step" />
        </label>

        <div class="btn-row">
          <button class="btn primary" @click="run">▶ 运行求解</button>
          <button class="btn" @click="runComparison">求解器对比</button>
        </div>
        <div class="btn-row">
          <select v-model="fitKind" class="mini-select">
            <option value="none">不拟合</option><option value="linear">线性</option>
            <option value="poly2">二次多项式</option><option value="exponential">指数衰减</option>
          </select>
          <button class="btn" @click="runFit">拟合</button>
          <button class="btn" @click="runSpectrum">频谱</button>
          <button class="btn" @click="runUncertainty">不确定度</button>
        </div>
        <div class="btn-row">
          <button class="btn" @click="saveSnapshot">保存快照</button>
          <button class="btn" @click="exportCurrent('markdown')">报告 MD</button>
          <button class="btn" @click="exportCurrent('html')">报告 HTML</button>
        </div>
        <p class="msg">{{ message }}</p>
        <p class="note">{{ preset.note }}</p>
      </section>

      <section class="panel results">
        <h2>轨迹与诊断</h2>
        <div v-if="traj" class="chart" v-html="chart"></div>
        <div v-else class="placeholder">选择模型并点击「运行求解」开始。</div>
        <p v-if="diagnosticsText" class="diag">{{ diagnosticsText }}</p>

        <div v-if="comparison.length" class="sub-block">
          <h3>求解器能量漂移对比（越小越好）</h3>
          <table><thead><tr><th>求解器</th><th>最终漂移</th><th>最大漂移</th><th>步数</th><th>拒绝步</th></tr></thead>
            <tbody><tr v-for="c in comparison" :key="c.solver"><td>{{ c.solver }}</td><td>{{ c.finalDrift.toExponential(3) }}</td><td>{{ c.maxDrift.toExponential(3) }}</td><td>{{ c.steps }}</td><td>{{ c.rejected }}</td></tr></tbody>
          </table>
        </div>

        <div v-if="fitResult" class="sub-block">
          <h3>拟合结果</h3>
          <p>{{ fitResult.label }} · R² {{ fitResult.r2.toFixed(6) }} · RMSE {{ fitResult.rmse.toPrecision(4) }} · AIC {{ fitResult.aic.toFixed(2) }}</p>
          <p class="mono">{{ fitResult.params.map((v, i) => `p${i} = ${v.toPrecision(6)} ± ${fitResult!.stdErrors[i].toPrecision(3)}`).join('　') }}</p>
        </div>
        <div v-if="spectrumText" class="sub-block"><h3>频谱</h3><p>{{ spectrumText }}</p></div>
        <div v-if="gumText" class="sub-block"><h3>不确定度</h3><p>{{ gumText }}</p></div>

        <div v-if="traj" class="sub-block">
          <h3>数据（{{ rows.length }} 组，<button class="link" @click="showTable = !showTable">{{ showTable ? '收起' : '展开' }}</button>）</h3>
          <table v-if="showTable"><thead><tr><th>t</th><th v-for="n in preset.stateNames" :key="n">{{ n }}</th></tr></thead>
            <tbody><tr v-for="(r, i) in rows.slice(0, 60)" :key="i"><td v-for="(v, j) in r" :key="j">{{ v.toFixed(4) }}</td></tr></tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.research { padding: 28px 32px; overflow: auto; height: 100%; box-sizing: border-box; background: #f6f8fa; }
.head h1 { margin: 0; font-size: 24px; color: #1f2937; }
.head .badge { font-size: 11px; background: #dff3ec; color: #2c6654; padding: 3px 8px; border-radius: 10px; vertical-align: middle; }
.sub { margin: 6px 0 20px; color: #64748b; font-size: 13px; }
.grid { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 18px; align-items: start; }
.panel { background: #fff; border: 1px solid #e5e9f0; border-radius: 12px; padding: 18px 20px; box-shadow: 0 2px 10px rgba(15,23,42,.04); }
.panel h2 { font-size: 14px; margin: 18px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #eef2f7; color: #2c6654; }
.panel h2:first-child { margin-top: 0; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; margin-bottom: 10px; }
.field > span { display: flex; justify-content: space-between; }
.field b { color: #1f2937; }
.field select, .field input[type=number], .mini-select { border: 1px solid #d9e1ea; border-radius: 7px; padding: 6px 8px; font-size: 13px; background: #fff; color: #1f2937; }
.field input[type=range] { accent-color: #3f8f79; }
.note { font-size: 12px; color: #64748b; line-height: 1.6; }
.btn-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.btn { border: 1px solid #d9e1ea; background: #fff; color: #334155; border-radius: 7px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
.btn:hover { border-color: #3f8f79; color: #2c6654; }
.btn.primary { background: #3f8f79; color: #fff; border-color: #3f8f79; }
.msg { margin-top: 12px; font-size: 12px; color: #2c6654; min-height: 18px; }
.chart { border: 1px solid #eef2f7; border-radius: 10px; overflow: hidden; }
.chart :deep(svg) { width: 100%; height: auto; display: block; }
.placeholder { padding: 60px 0; text-align: center; color: #94a3b8; font-size: 13px; }
.diag { font-size: 12px; color: #475569; background: #f1f5f9; padding: 8px 10px; border-radius: 7px; }
.sub-block { margin-top: 18px; }
.sub-block h3 { font-size: 13px; margin: 0 0 8px; color: #334155; }
.sub-block p { font-size: 12px; color: #475569; margin: 4px 0; }
.mono { font-family: ui-monospace, Consolas, monospace; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { border: 1px solid #e8edf3; padding: 5px 8px; text-align: left; }
th { background: #f8fafc; color: #475569; }
.link { border: none; background: none; color: #3f8f79; cursor: pointer; font-size: 12px; }
@media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }
</style>
