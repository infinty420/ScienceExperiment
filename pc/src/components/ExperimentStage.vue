<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { Engine } from '../engine/core'
import { getSceneDef, getQuiz, buildExperiment } from '../experiments/loader'
import type { PhysicsWorld } from '../engine/physics'
import type { ExperimentLogic, ParamDef, RecordColumn, Row, InstrumentDef, OpEvent, ExamGoal } from '../experiments/types'
import { sigmaOf, gaussNoise } from '../engine/stat'
import { paramScan, type ScanResult } from '../experiments/scan'
import DataPanel from './DataPanel.vue'
import TimeControlBar from './TimeControlBar.vue'
import InstrumentPanel from './InstrumentPanel.vue'
import ExamPanel from './ExamPanel.vue'
import QuizPanel from './QuizPanel.vue'
import { saveHistory } from '../store/history'
import { markDone, markQuiz } from '../store/progress'
import { searchFaq } from '../data/faq'
import { diagnoseNew, diagnose, type Diagnosis } from '../data/diagnose'

const props = defineProps<{ experimentId: string; title: string; compact?: boolean }>()
const emit = defineEmits<{ (e: 'back'): void }>()

const fps = ref(0)
const status = ref('加载中…')
const params = ref<ParamDef[]>([])
const paramValues = ref<Record<string, number>>({})
const columns = ref<RecordColumn[]>([])
const rows = ref<Row[]>([])
const resultLines = ref<string[]>([])
const noteText = ref('')
const liveText = ref('')
const theory = ref<{ points: Array<[number, number]>; label: string } | null>(null)
const curveDef = ref<{ x: string; y: string; title: string } | null>(null)
const guideText = ref('')
const state = ref<'idle' | 'running' | 'paused' | 'done'>('idle')

/* ───── V2：时间控制（T1） ───── */
const timeScale = ref(1)
const timePaused = ref(false)
function onTimeScale(v: number): void {
  timeScale.value = v
  if (engine) engine.timeScale = v
}
function onTimePaused(v: boolean): void {
  timePaused.value = v
  if (engine) engine.paused = v
}
function stepOnce(): void {
  engine?.stepOnce()
}

/* ───── V2：录制/回放（T1） ───── */
interface RecEvent {
  t: number
  type: string
  payload: Record<string, unknown>
}
const recording = ref(false)
const replaying = ref(false)
const replayProgress = ref(0)
const recDuration = ref(0)
let recEvents: RecEvent[] = []
let recT = 0

function toggleRecord(): void {
  if (replaying.value) return
  if (!recording.value) {
    recEvents = []
    recT = 0
    recording.value = true
  } else {
    recording.value = false
    recDuration.value = recT
    if (recEvents.length > 0) {
      // 进入回放预览
      replaying.value = true
      replayProgress.value = 0
      if (engine) engine.paused = true
      timePaused.value = true
      applyReplay(0)
    }
  }
}

function applyReplay(progress: number): void {
  const t = progress * recDuration.value
  rows.value = []
  resultLines.value = []
  theory.value = null
  noteText.value = ''
  for (const e of recEvents) {
    if (e.t > t) break
    if (e.type === 'data') rows.value.push(e.payload.row as number[])
    else if (e.type === 'rows') rows.value = e.payload.rows as number[][]
    else if (e.type === 'result') resultLines.value = e.payload.lines as string[]
    else if (e.type === 'theory') theory.value = { points: e.payload.points as Array<[number, number]>, label: e.payload.label as string }
    else if (e.type === 'note') noteText.value = e.payload.text as string
  }
}

function exitReplay(): void {
  replaying.value = false
  if (engine) engine.paused = false
  timePaused.value = false
  rows.value = []
  resultLines.value = []
  theory.value = null
  noteText.value = ''
}

/* ───── V2：模拟测量误差（T5） ───── */
const noiseEnabled = ref(false)

/* ───── V2：手动测量模式（T2） ───── */
const manualMode = ref(false)
const defInstruments = ref<InstrumentDef[]>([])
const trueValues = ref<Record<string, number>>({})
let lastTrueRow: Row | null = null

function onInstrumentRecord(readings: Record<string, number>): void {
  if (state.value === 'idle') return
  const base = lastTrueRow ? [...lastTrueRow] : columns.value.map(() => 0)
  for (const [col, v] of Object.entries(readings)) {
    const i = columns.value.findIndex((c) => c.id === col)
    if (i >= 0) base[i] = v
  }
  rows.value.push(base)
  pushEvent('record', `仪器读数 ${Object.values(readings).join(' / ')}`)
}

function onOverRange(inst: InstrumentDef, v: number): void {
  pushEvent('instrument', `${inst.label} 超量程（${v.toFixed(2)}）打表`)
}

const trueValuesLive = computed(() => {
  const out: Record<string, number> = { ...trueValues.value }
  if (lastTrueRow) {
    columns.value.forEach((c, i) => {
      if (out[c.id] === undefined && lastTrueRow && i < lastTrueRow.length) out[c.id] = lastTrueRow![i]
    })
  }
  return out
})

/* ───── V2：操作事件流（T8 诊断 / T4 步骤分） ───── */
const opEvents = ref<OpEvent[]>([])
let opT = 0
function pushEvent(type: OpEvent['type'], detail: string): void {
  opEvents.value.push({ t: Math.round(opT * 10) / 10, type, detail })
}

/* ───── V2：AI 诊断（T8） ───── */
const diagnoses = ref<Diagnosis[]>([])
const reportedRules = new Set<string>()
let lastFitR2: number | null = null

function runDiagnose(): void {
  if (replaying.value) return
  const def = getSceneDef(props.experimentId)
  if (!def) return
  const news = diagnoseNew(
    {
      def,
      events: opEvents.value,
      rows: rows.value,
      paramValues: paramValues.value,
      fitR2: lastFitR2
    },
    reportedRules
  )
  if (news.length > 0) diagnoses.value.push(...news)
}

/* ───── V2：考核模式（T4） ───── */
const examOpen = ref(false)
const examScore = ref<{ total: number; items: Array<{ name: string; earned: number; full: number; note: string }> } | null>(null)

/** 从结果行提取指标：metric 为关键词，取首个匹配行的最后一个数值 */
function metricFromLines(metric: string, lines: string[]): number | undefined {
  for (const line of lines) {
    if (line.includes(metric)) {
      const nums = line.match(/-?\d+\.?\d*/g)
      if (nums && nums.length > 0) return Number(nums[nums.length - 1])
    }
  }
  return undefined
}

function gradeExam(): void {
  const def = getSceneDef(props.experimentId)
  if (!def?.exam) return
  const exam = def.exam
  const items: Array<{ name: string; earned: number; full: number; note: string }> = []
  let goalWeightSum = 0

  // 指标可从参数取真值（如 g 设定值）
  const metrics = logic?.evaluate?.({ rows: rows.value, paramValues: paramValues.value }) ?? {}

  for (const g of exam.goals) {
    goalWeightSum += g.weight
    if (g.minRecords !== undefined) {
      const got = Math.min(rows.value.length / g.minRecords, 1)
      items.push({
        name: `数据组数（≥${g.minRecords} 组）`,
        earned: Math.round(got * g.weight),
        full: g.weight,
        note: `实际 ${rows.value.length} 组`
      })
    } else if (g.expect !== undefined && g.tolerance !== undefined) {
      let expect = g.expect
      if ((g as ExamGoal & { expectFromParam?: string }).expectFromParam) {
        const pv = paramValues.value[(g as ExamGoal & { expectFromParam?: string }).expectFromParam!]
        if (pv !== undefined) expect = pv
      }
      const v = metrics[g.metric] ?? metricFromLines(g.metric, resultLines.value)
      if (v === undefined) {
        items.push({ name: `测量「${g.metric}」`, earned: 0, full: g.weight, note: '未测得该指标' })
      } else {
        const err = Math.abs(v - expect)
        const tol = g.tolerance
        const earned = err <= tol ? g.weight : err <= 2 * tol ? Math.round(g.weight * (1 - (err - tol) / tol)) : 0
        items.push({
          name: `测量「${g.metric}」目标 ${expect}`,
          earned,
          full: g.weight,
          note: `实测 ${v.toFixed(3)}（偏差 ${err.toFixed(3)}，容差 ${tol}）`
        })
      }
    }
  }

  // 步骤分 = 剩余分，按 checklist 关键词匹配操作事件
  const stepWeight = Math.max(0, 100 - goalWeightSum)
  if (stepWeight > 0 && exam.checklist.length > 0) {
    const per = Math.round((stepWeight / exam.checklist.length) * 10) / 10
    let hitCount = 0
    const hits: string[] = []
    for (const c of exam.checklist) {
      const hit = opEvents.value.some((e) => e.detail.includes(c) || c.includes(e.detail))
      if (hit) {
        hitCount++
        hits.push(c)
      }
    }
    items.push({
      name: '规范操作步骤',
      earned: Math.round(per * hitCount),
      full: stepWeight,
      note: hitCount === exam.checklist.length ? '全部完成' : `完成 ${hitCount}/${exam.checklist.length}：${hits.join('、') || '未检出'}`
    })
  }

  const total = Math.min(100, Math.round(items.reduce((s, it) => s + it.earned, 0)))
  examScore.value = { total, items }
  saveHistory({
    experimentId: props.experimentId,
    title: props.title,
    subject: props.experimentId.split('.')[0],
    date: new Date().toLocaleString('zh-CN'),
    params: { ...paramValues.value },
    paramLabels: Object.fromEntries(params.value.map((p) => [p.id, p.label])),
    resultLines: [`考核得分：${total} / 100`],
    rowCount: rows.value.length,
    mode: 'exam',
    score: total
  })
}

/* ───── V2：题库（T7） ───── */
const quizOpen = ref<'preview' | 'review' | null>(null)
const quizDef = computed(() => getQuiz(props.experimentId) ?? null)

function onQuizDone(r: { correct: number; total: number }): void {
  if (!quizOpen.value) return
  const pct = r.total > 0 ? Math.round((r.correct / r.total) * 100) : 0
  markQuiz(props.experimentId, quizOpen.value, pct)
}

/* ───── V2：参数扫描（T9） ───── */
const scanOpen = ref(false)
const scanParamId = ref('')
const scanFrom = ref(0)
const scanTo = ref(1)
const scanSteps = ref(9)
const scanRunning = ref(false)
const scanResult = ref<ScanResult | null>(null)

const scanValues = computed(() => {
  const p = params.value.find((x) => x.id === scanParamId.value)
  const from = Math.min(scanFrom.value, scanTo.value)
  const to = Math.max(scanFrom.value, scanTo.value)
  const n = Math.max(2, Math.min(41, scanSteps.value))
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(+(from + ((to - from) * i) / (n - 1)).toFixed((p?.step ?? 0.1) < 0.01 ? 3 : 2))
  return out
})

function openScan(): void {
  const first = params.value[0]
  if (first && !scanParamId.value) {
    scanParamId.value = first.id
    scanFrom.value = first.min
    scanTo.value = first.max
  }
  scanOpen.value = !scanOpen.value
}

function runScan(): void {
  if (!engine || !physics || !logic || !scanParamId.value || scanRunning.value) return
  scanRunning.value = true
  const def = getSceneDef(props.experimentId)
  if (!def) return
  // 同步 headless 仿真（纯计算，13 组 × 12s 仿真 < 1s）
  const result = paramScan(engine, physics, logic, def, scanParamId.value, scanValues.value, 12)
  scanResult.value = result
  scanRunning.value = false
  pushEvent('fit', `参数扫描 ${scanParamId.value} × ${scanValues.value.length} 组`)
}

function scanToTable(): void {
  const r = scanResult.value
  if (!r) return
  const pv = params.value.find((x) => x.id === scanParamId.value)
  const paramLabel = pv?.label ?? scanParamId.value
  columns.value = [
    { id: '__scanX', label: paramLabel, digits: 2 },
    { id: '__scanY', label: r.metricName || '指标', digits: 3 }
  ]
  rows.value = r.points.map((p) => {
    const v = Object.values(p.metrics)[0] ?? 0
    return [p.param, +v.toFixed(4)]
  })
  curveDef.value = { x: '__scanX', y: '__scanY', title: `参数扫描：${paramLabel} → ${r.metricName}` }
}

/* ───── 引擎装配 ───── */
let engine: Engine | null = null
let physics: PhysicsWorld | null = null
let logic: ExperimentLogic | null = null
const canvasRef = ref<HTMLCanvasElement | null>(null)

function post(type: string, payload: Record<string, unknown>): void {
  if (type === 'fps') {
    fps.value = payload.fps as number
    return
  }
  if (replaying.value) return // 回放期间丢弃实时事件
  if (type === 'data') {
    const row = payload.row as number[]
    lastTrueRow = row
    if (recording.value) recEvents.push({ t: recT, type, payload })
    if (manualMode.value) return // 手动模式：真值仅缓存
    rows.value.push(noiseEnabled.value ? addNoise(row) : row)
    return
  }
  if (type === 'rows') {
    rows.value = payload.rows as number[][]
    if (recording.value) recEvents.push({ t: recT, type, payload })
    return
  }
  if (type === 'result') {
    resultLines.value = payload.lines as string[]
    state.value = 'done'
    if (recording.value) recEvents.push({ t: recT, type, payload })
    // W8：保存历史成绩
    const def = getSceneDef(props.experimentId)
    if (def && !replaying.value) {
      const paramLabels: Record<string, string> = {}
      for (const p of params.value) paramLabels[p.id] = p.label
      saveHistory({
        experimentId: props.experimentId,
        title: props.title,
        subject: def.id.split('.')[0],
        date: new Date().toLocaleString('zh-CN'),
        params: { ...paramValues.value },
        paramLabels,
        resultLines: resultLines.value,
        rowCount: rows.value.length
      })
      markDone(props.experimentId)
    }
    runDiagnose()
    return
  }
  if (type === 'theory') {
    theory.value = { points: payload.points as Array<[number, number]>, label: payload.label as string }
    if (recording.value) recEvents.push({ t: recT, type, payload })
    return
  }
  if (type === 'note') {
    noteText.value = payload.text as string
    if (recording.value) recEvents.push({ t: recT, type, payload })
    return
  }
  if (type === 'live') {
    const i = payload.current as number
    const p = payload.lampPower as number
    liveText.value = `电流 I = ${i.toFixed(3)} A · 灯泡功率 P = ${p.toFixed(2)} W`
    // V2：电流表仪器真值（recordColumn 'I'）
    trueValues.value = { current: i, power: p, I: i }
    return
  }
  if (type === 'measure') {
    // 实验主动推送真值（仪器读数用）
    const vals = payload.values as Record<string, number>
    trueValues.value = { ...trueValues.value, ...vals }
    return
  }
}

/** 误差注入（noiseEnabled 时对声明了 sigma 的列加高斯噪声） */
function addNoise(row: Row): Row {
  return row.map((v, i) => {
    const sigma = columns.value[i]?.sigma ?? 0
    return sigma > 0 ? +(v + gaussNoise(sigma)).toFixed(columns.value[i]?.digits ?? 3) : v
  })
}

/** V3：键盘快捷键（空格=开始/暂停、.=单步、R=重置）；输入框聚焦时忽略 */
function onKeydown(ev: KeyboardEvent): void {
  const target = ev.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  if (replaying.value) return
  if (ev.key === ' ') {
    ev.preventDefault()
    if (state.value === 'running') pause()
    else start()
  } else if (ev.key === '.') {
    ev.preventDefault()
    stepOnce()
  } else if (ev.key === 'r' || ev.key === 'R') {
    reset()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  const canvas = canvasRef.value
  if (!canvas) return

  engine = new Engine(canvas)
  engine.onPost = post
  engine.onFrame = (dt) => {
    if (recording.value) {
      recT += dt
      if (recEvents.length > 2000) recEvents.shift()
    }
    opT += dt
  }

  const def = getSceneDef(props.experimentId)
  if (!def) {
    status.value = `未找到实验定义: ${props.experimentId}`
    return
  }

  const built = buildExperiment(engine, def, post)
  if (!built) {
    status.value = '该实验暂无逻辑实现'
    return
  }
  physics = built.physics
  logic = built.logic

  params.value = def.params
  paramValues.value = Object.fromEntries(def.params.map((p) => [p.id, p.value]))
  columns.value = def.records
  curveDef.value = def.curve ?? null
  guideText.value = def.guide
  defInstruments.value = def.instruments ?? []
  status.value = '就绪'

  engine.updatables.push((dt: number) => {
    physics?.step(dt)
    logic?.update(dt)
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  logic?.dispose()
  physics?.dispose()
  engine?.dispose()
  engine = null
  physics = null
  logic = null
})

function onParam(p: ParamDef, value: number): void {
  if (replaying.value) return
  paramValues.value[p.id] = value
  logic?.onParam(p.id, value)
  pushEvent('param', `${p.label} ${value}${p.unit ? ' ' + p.unit : ''}`)
  if (state.value !== 'idle') {
    state.value = 'idle'
    rows.value = []
    resultLines.value = []
    theory.value = null
    noteText.value = ''
  }
}

function start(): void {
  if (state.value === 'running' || replaying.value) return
  if (state.value !== 'paused') {
    rows.value = []
    resultLines.value = []
    theory.value = null
    noteText.value = ''
  }
  logic?.start()
  state.value = 'running'
  pushEvent('start', '开始实验')
}

function pause(): void {
  logic?.pause()
  state.value = 'paused'
  pushEvent('pause', '暂停')
}

function reset(): void {
  if (replaying.value) {
    exitReplay()
    return
  }
  logic?.reset()
  state.value = 'idle'
  rows.value = []
  resultLines.value = []
  theory.value = null
  noteText.value = ''
  pushEvent('reset', '重置')
}

/* ───── V2：报告 2.0（T6） ───── */
const homeworkMode = ref(false)
const dataPanelRef = ref<InstanceType<typeof DataPanel> | null>(null)

function exportReport(): void {
  const def = getSceneDef(props.experimentId)
  const chartCanvas = document.querySelector('.data-panel .chart') as HTMLCanvasElement | null
  const chartImg = chartCanvas ? chartCanvas.toDataURL('image/png') : ''
  const paramRows = params.value
    .map((p) => `<tr><td>${p.label}</td><td>${paramValues.value[p.id] ?? '—'} ${p.unit ?? ''}</td></tr>`)
    .join('')
  const dataRows = rows.value.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')
  const headCells = columns.value.map((c) => `<th>${c.label}</th>`).join('')

  const fitText = dataPanelRef.value?.fitResult ?? ''
  const resultHtml = resultLines.value.map((l) => `<li>${l}</li>`).join('')

  // 误差分析段（T6）
  const usingNoise = noiseEnabled.value || manualMode.value
  let errorSection = ''
  if (usingNoise && rows.value.length >= 3) {
    const sigmas = columns.value.map((c) => c.sigma ?? 0)
    const namedCols = columns.value.filter((c, i) => sigmas[i] > 0).map((c) => c.label)
    errorSection = `<h2>${homeworkMode.value ? '五' : '五'}、误差分析（请结合数据填写）</h2>
<ul>
<li>主要误差来源：${namedCols.length > 0 ? namedCols.map((c) => `「${c}」测量噪声` ).join('、') : '仪器精度与人手操作'}</li>
<li>减小误差的方法：多次测量取平均值；${manualMode.value ? '计时类量建议累计 N 个周期再除以 N' : '适当增加数据组数'}；读数时视线正对刻度</li>
</ul>`
  }

  const conclusionSection = homeworkMode.value
    ? `<h2>四、实验结论（作业模式：请手写后打印）</h2>
<div style="border:1px dashed #bbb;border-radius:8px;min-height:160px;padding:12px;color:#999">（此处留空，请在打印件上手写结论：规律描述、公式、与理论值对比）</div>`
    : `<h2>四、结论</h2><ol>${resultHtml || '<li>（未生成结论，请完成实验）</li>'}</ol>${fitText ? `<p style="font-family:Consolas,monospace;color:#a44">拟合：${fitText}</p>` : ''}`

  const modeTag = examScore.value ? `考核 ${examScore.value.total} 分` : homeworkMode.value ? '作业模式' : '练习'
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>实验报告 - ${props.title}</title>
<style>body{font-family:'Microsoft YaHei',sans-serif;max-width:800px;margin:24px auto;color:#222;padding:0 16px}
h1{font-size:22px;border-bottom:2px solid #3f8f79;padding-bottom:8px}h2{font-size:16px;color:#3f8f79;margin-top:20px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:5px 9px;text-align:left}
th{background:#eaf5f0}img{max-width:100%;border:1px solid #eee}li{line-height:1.9;margin:4px 0}</style></head><body>
<h1>智实验 SciLab · 实验报告</h1>
<p>实验名称：${props.title} ｜ 完成时间：${new Date().toLocaleString('zh-CN')} ｜ ${modeTag} ｜ 记录 ${rows.value.length} 组数据</p>
<h2>一、实验参数</h2><table><tr><th>参数</th><th>取值</th></tr>${paramRows || '<tr><td colspan="2">无</td></tr>'}</table>
<h2>二、数据记录</h2><table><tr>${headCells}</tr>${dataRows || '<tr><td colspan="9">（无数据）</td></tr>'}</table>
${chartImg ? `<h2>三、曲线</h2><img src="${chartImg}" alt="curve">` : ''}
${conclusionSection}
${errorSection}
${def?.guide ? `<h2>六、实验原理</h2><p style="line-height:1.8;color:#555">${def.guide}</p>` : ''}
<p style="margin-top:28px;color:#999;font-size:12px">由智实验 SciLab（理科 3D 虚拟实验室）自动生成 · 全程离线</p>
</body></html>`
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `实验报告_${props.title}_${new Date().toISOString().slice(0, 10)}.html`
  a.click()
  URL.revokeObjectURL(url)
}

function exportCsv(): void {
  const head = columns.value.map((c) => c.label).join(',')
  const body = rows.value.map((r) => r.join(',')).join('\n')
  const csv = '\ufeff' + head + '\n' + body
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `数据_${props.title}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/* ───── V2：AI 助教（三标签：答疑 / 步骤 / 诊断） ───── */
const aiOpen = ref(false)
const aiQuestion = ref('')
const aiAnswer = ref('')
const aiHit = ref(false)
const aiTab = ref<'qa' | 'steps' | 'diag'>('qa')

const guideSteps = computed(() => {
  const def = getSceneDef(props.experimentId)
  const fromGuide = (def?.guide ?? '')
    .split(/[。；]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4)
    .slice(0, 6)
    .map((s, i) => `${i + 3}. ${s}`)
  return [
    '1. 明确实验目的与原理（见下方"实验说明"）',
    '2. 拖动参数滑杆设置实验条件',
    ...fromGuide,
    `${(fromGuide.length ?? 0) + 3}. 点击「开始」运行并观察 3D 现象与曲线（可慢动作/单步）`,
    `${(fromGuide.length ?? 0) + 4}. 记录多组数据（改变参数重复实验），可用「线性拟合」分析`,
    `${(fromGuide.length ?? 0) + 5}. 完成后「导出报告」生成实验报告`
  ]
})

function askAi(): void {
  const hit = searchFaq(props.experimentId, aiQuestion.value.trim())
  if (hit) {
    aiAnswer.value = hit.a
    aiHit.value = true
  } else {
    aiAnswer.value = '这个问题超出了本地知识库（离线检索式助教）。可以尝试提问：误差原因、视角操作、数据导出，或查看右侧「实验说明」。接入端侧大模型后（方案 W9 第②级）可回答更开放的问题。'
    aiHit.value = false
  }
}

const examDef = computed(() => getSceneDef(props.experimentId)?.exam ?? null)

/** 对照模式快照导出（App.vue CompareView 用） */
defineExpose({
  getSnapshot: () => ({ columns: columns.value, rows: rows.value, curve: curveDef.value, title: props.title })
})

function onFitInfo(r2: number): void {
  lastFitR2 = r2
  pushEvent('fit', `线性拟合 R²=${r2.toFixed(4)}`)
  runDiagnose()
}
</script>

<template>
  <div class="stage">
    <div class="toolbar">
      <button class="back" @click="emit('back')">‹ 返回</button>
      <span class="title">{{ title }}</span>
      <button class="tool-btn" @click="exportReport">导出报告</button>
      <button class="tool-btn" @click="exportCsv" v-if="columns.length">导出 CSV</button>
      <button class="tool-btn" v-if="examDef" :class="{ hot: examScore }" @click="examOpen = !examOpen; examScore = examOpen ? examScore : null">
        {{ examScore ? `考核 ${examScore.total} 分` : '考核模式' }}
      </button>
      <button class="tool-btn" v-if="quizDef" @click="quizOpen = 'preview'">预习检测</button>
      <button class="tool-btn" v-if="quizDef" @click="quizOpen = 'review'" :disabled="state !== 'done'">课后检验</button>
      <button class="tool-btn" @click="aiOpen = true">AI 助教</button>
      <label class="hw-check" title="作业模式：报告结论留空供手写">
        <input type="checkbox" v-model="homeworkMode" /> 作业模式
      </label>
      <span class="fps" :class="{ ok: fps > 0 }">{{ fps > 0 ? `${fps} FPS` : '…' }}</span>
    </div>

    <TimeControlBar
      :time-scale="timeScale"
      :paused="timePaused"
      :recording="recording"
      :replaying="replaying"
      @update:time-scale="onTimeScale"
      @update:paused="onTimePaused"
      @step="stepOnce"
      @toggle-record="toggleRecord"
    />

    <div v-if="replaying" class="replay-bar">
      <button class="btn sm" @click="exitReplay">退出回放</button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.005"
        v-model.number="replayProgress"
        @input="applyReplay(replayProgress)"
      />
      <span class="replay-time">{{ (replayProgress * recDuration).toFixed(1) }}s / {{ recDuration.toFixed(1) }}s</span>
    </div>

    <!-- AI 助教弹窗 -->
    <div class="ai-mask" v-if="aiOpen" @click.self="aiOpen = false">
      <div class="ai-dialog">
        <div class="ai-head">
          <span>AI 助教 · 本地智能（离线）</span>
          <button class="ai-close" @click="aiOpen = false">✕</button>
        </div>
        <div class="ai-tabs">
          <button :class="{ tab: true, on: aiTab === 'qa' }" @click="aiTab = 'qa'">答疑</button>
          <button :class="{ tab: true, on: aiTab === 'steps' }" @click="aiTab = 'steps'">实验步骤</button>
          <button :class="{ tab: true, on: aiTab === 'diag' }" @click="aiTab = 'diag'; runDiagnose()">
            诊断{{ diagnoses.length ? ` (${diagnoses.length})` : '' }}
          </button>
        </div>
        <div class="ai-body" v-if="aiTab === 'qa'">
          <div class="ai-ask">
            <input v-model="aiQuestion" placeholder="例如：为什么实测值有误差？" @keyup.enter="askAi" />
            <button class="btn primary" @click="askAi">提问</button>
          </div>
          <div class="ai-answer" v-if="aiAnswer" :class="{ miss: !aiHit }">{{ aiAnswer }}</div>
          <div class="ai-tip" v-else>可尝试：误差原因 / 怎么调视角 / 数据怎么导出，以及本实验专属问题</div>
        </div>
        <div class="ai-body" v-else-if="aiTab === 'steps'">
          <ol class="steps-list">
            <li v-for="(s, i) in guideSteps" :key="i">{{ s }}</li>
          </ol>
        </div>
        <div class="ai-body" v-else>
          <div v-if="diagnoses.length === 0" class="ai-tip">暂未发现操作问题。完成实验或调整参数后，诊断会自动分析你的操作记录。</div>
          <div v-for="(d, i) in diagnoses" :key="i" class="diag-card" :class="d.level">
            <div class="diag-title">{{ d.level === 'error' ? '⛔' : d.level === 'warn' ? '⚠️' : '💡' }} {{ d.title }}</div>
            <div class="diag-tip">{{ d.tip }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="body">
      <div class="canvas-wrap">
        <canvas ref="canvasRef" class="stage-canvas"></canvas>
        <div class="hud">拖拽旋转 · 滚轮缩放{{ timeScale !== 1 ? ` · ${timeScale}× 慢放` : '' }}</div>
        <div class="note" v-if="noteText">{{ noteText }}</div>

        <!-- 考核面板 -->
        <ExamPanel
          v-if="examOpen && examDef"
          :exam="examDef"
          :title="title"
          :score-detail="examScore"
          @start="examScore = null; opEvents = []; reportedRules.clear(); diagnoses = []"
          @submit="gradeExam"
          @close="examOpen = false"
        />

        <!-- 题库面板 -->
        <QuizPanel
          v-if="quizOpen && quizDef"
          :title="title"
          :phase="quizOpen"
          :questions="quizOpen === 'preview' ? quizDef.preview : quizDef.review"
          @done="onQuizDone"
          @close="quizOpen = null"
        />
      </div>

      <aside class="side" :class="{ compact }">
        <section class="sec">
          <h3>参数</h3>
          <div class="param" v-for="p in params" :key="p.id">
            <div class="param-label">
              {{ p.label }}<template v-if="p.unit"> ({{ p.unit }})</template>
              <span class="param-value">{{ paramValues[p.id] }}</span>
            </div>
            <input
              type="range"
              :min="p.min"
              :max="p.max"
              :step="p.step"
              :value="paramValues[p.id]"
              :disabled="replaying"
              @input="onParam(p, Number(($event.target as HTMLInputElement).value))"
            />
          </div>
          <div v-if="params.length === 0" class="empty">无参数</div>

          <!-- V2：参数扫描 -->
          <div class="scan-entry">
            <button class="mini-btn" @click="openScan">{{ scanOpen ? '收起扫描' : '⚙ 参数扫描' }}</button>
          </div>
          <div v-if="scanOpen" class="scan-form">
            <select v-model="scanParamId" class="scan-select">
              <option v-for="p in params" :key="p.id" :value="p.id">{{ p.label }}</option>
            </select>
            <div class="scan-row">
              <label>从 <input type="number" v-model.number="scanFrom" /></label>
              <label>到 <input type="number" v-model.number="scanTo" /></label>
              <label>{{ scanSteps }} 点 <input type="range" min="3" max="41" v-model.number="scanSteps" /></label>
            </div>
            <button class="mini-btn primary" :disabled="scanRunning" @click="runScan">
              {{ scanRunning ? '扫描中…' : `开始扫描（${scanValues.length} 组）` }}
            </button>
            <div v-if="scanResult" class="scan-result">
              <div v-if="scanResult.optimum" class="scan-opt">
                🎯 最优：{{ params.find((p) => p.id === scanParamId)?.label }} = {{ scanResult.optimum.param }} →
                {{ scanResult.metricName }} = {{ scanResult.optimum.value }}
              </div>
              <button class="mini-btn" @click="scanToTable">写入数据表（{{ scanResult.points.length }} 点）</button>
            </div>
          </div>
        </section>

        <section class="sec">
          <h3>控制</h3>
          <div class="controls">
            <button class="btn primary" :disabled="state === 'running' || replaying" @click="start">
              {{ state === 'paused' ? '继续' : '开始' }}
            </button>
            <button class="btn" :disabled="state !== 'running'" @click="pause">暂停</button>
            <button class="btn" @click="reset">{{ replaying ? '退出回放' : '重置' }}</button>
            <span class="status">{{ status }}</span>
          </div>
          <div class="live" v-if="liveText">{{ liveText }}</div>

          <!-- V2：记录模式 -->
          <div class="mode-row" v-if="defInstruments.length > 0 || columns.some((c) => c.sigma)">
            <label class="mode-check" v-if="defInstruments.length > 0" title="亲手用虚拟仪器读数记录，而非自动记录">
              <input type="checkbox" v-model="manualMode" /> 手动测量
            </label>
            <label class="mode-check" v-if="columns.some((c) => c.sigma) && !manualMode" title="为数据注入仪器级高斯噪声">
              <input type="checkbox" v-model="noiseEnabled" /> 模拟误差
            </label>
          </div>
          <div v-if="manualMode" class="manual-tip">手动测量模式：用下方仪器读数，数据带仪器误差</div>

          <div class="result" v-if="resultLines.length">
            <div v-for="(l, i) in resultLines" :key="i" class="result-line">{{ l }}</div>
          </div>
        </section>

        <!-- V2：虚拟仪器 -->
        <section class="sec" v-if="defInstruments.length > 0 && manualMode">
          <h3>虚拟仪器</h3>
          <InstrumentPanel
            :instruments="defInstruments"
            :true-values="trueValuesLive"
            :disabled="state === 'idle'"
            @record="onInstrumentRecord"
            @over-range="onOverRange"
          />
        </section>

        <section class="sec grow">
          <h3>数据记录</h3>
          <DataPanel
            ref="dataPanelRef"
            :columns="columns"
            :rows="rows"
            :curve="curveDef"
            :theory="theory"
            @fit="onFitInfo"
          />
        </section>

        <section class="sec" v-if="guideText">
          <h3>实验说明</h3>
          <p class="guide">{{ guideText }}</p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.stage {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7ea;
  flex-wrap: wrap;
}

.back {
  background: none;
  font-size: 15px;
  color: #666;
  padding: 4px 8px;
}

.title {
  font-size: 15px;
  font-weight: 600;
}

.fps {
  margin-left: auto;
  font-size: 12px;
  color: #aaa;
  font-family: Consolas, monospace;
}

.fps.ok {
  color: #3f8f79;
}

.tool-btn {
  margin-left: 4px;
  padding: 4px 12px;
  font-size: 12px;
  background: #eef1f4;
  color: #445;
}

.tool-btn:hover {
  background: #dfe6ec;
}

.tool-btn.hot {
  background: #8a5fb8;
  color: #fff;
}

.tool-btn:disabled {
  opacity: 0.45;
}

.hw-check {
  margin-left: 8px;
  font-size: 12px;
  color: #889;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.replay-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px;
  background: #f7efdd;
  border-bottom: 1px solid #eadfc4;
}

.replay-bar input[type='range'] {
  flex: 1;
  accent-color: #b07a2e;
}

.replay-time {
  font-size: 12px;
  font-family: Consolas, monospace;
  color: #b07a2e;
}

.btn.sm {
  padding: 3px 10px;
  font-size: 12px;
}

.ai-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.ai-dialog {
  width: 420px;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.ai-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #3f8f79;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
}

.ai-close {
  background: none;
  color: #fff;
  font-size: 14px;
}

.ai-tabs {
  display: flex;
  border-bottom: 1px solid #eef1f4;
}

.ai-tabs .tab {
  flex: 1;
  background: none;
  font-size: 13px;
  color: #889;
  padding: 10px 0;
  border-bottom: 2px solid transparent;
}

.ai-tabs .tab.on {
  color: #3f8f79;
  border-bottom-color: #3f8f79;
  font-weight: 500;
}

.steps-list {
  padding-left: 20px;
  font-size: 13px;
  color: #445;
  line-height: 2.1;
}

.ai-body {
  padding: 16px;
  max-height: 380px;
  overflow-y: auto;
}

.ai-ask {
  display: flex;
  gap: 8px;
}

.ai-ask input {
  flex: 1;
  border: 1px solid #d8dde2;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
  outline: none;
}

.ai-ask input:focus {
  border-color: #3f8f79;
}

.ai-answer {
  margin-top: 12px;
  background: #eaf5f0;
  border-radius: 8px;
  padding: 12px;
  font-size: 13px;
  line-height: 1.7;
  color: #2c6e5c;
}

.ai-answer.miss {
  background: #f5f0e6;
  color: #8a7040;
}

.ai-tip {
  margin-top: 12px;
  font-size: 12px;
  color: #999;
}

.diag-card {
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  font-size: 12px;
}

.diag-card.error {
  background: #faecec;
  border: 1px solid #e3b8b8;
}

.diag-card.warn {
  background: #f7efdd;
  border: 1px solid #e3d4ab;
}

.diag-card.info {
  background: #eaf0fa;
  border: 1px solid #b9c9e6;
}

.diag-title {
  font-weight: 600;
  color: #433;
  margin-bottom: 4px;
}

.diag-tip {
  color: #665;
  line-height: 1.6;
}

.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.canvas-wrap {
  flex: 1;
  position: relative;
  background: #1a2430;
  min-width: 0;
}

.stage-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.hud {
  position: absolute;
  top: 8px;
  left: 10px;
  color: #9fb3c8;
  font: 11px Consolas, monospace;
  pointer-events: none;
  user-select: none;
}

.note {
  position: absolute;
  top: 8px;
  right: 10px;
  background: rgba(230, 160, 60, 0.9);
  color: #fff;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
}

/* 右侧面板 */
.side {
  width: 340px;
  flex-shrink: 0;
  background: #fff;
  border-left: 1px solid #e5e7ea;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.side.compact {
  width: 260px;
}

.sec {
  padding: 12px 14px;
  border-bottom: 1px solid #f0f2f4;
}

.sec.grow {
  flex: 1;
  min-height: 320px;
}

.sec h3 {
  font-size: 12px;
  color: #889;
  font-weight: 600;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.param {
  margin-bottom: 10px;
}

.param-label {
  display: flex;
  align-items: baseline;
  font-size: 12px;
  color: #445;
  margin-bottom: 4px;
}

.param-value {
  margin-left: auto;
  font-family: Consolas, monospace;
  color: #3f8f79;
  font-size: 12px;
}

.param input[type='range'] {
  width: 100%;
  accent-color: #3f8f79;
}

.empty {
  font-size: 12px;
  color: #aaa;
}

.scan-entry {
  margin-top: 6px;
}

.mini-btn {
  font-size: 11px;
  padding: 4px 10px;
  border: 1px solid #d8dde2;
  border-radius: 6px;
  background: #fff;
  color: #556;
  cursor: pointer;
}

.mini-btn.primary {
  background: #3e6fb0;
  border-color: #3e6fb0;
  color: #fff;
}

.mini-btn:disabled {
  opacity: 0.5;
}

.scan-form {
  margin-top: 8px;
  border: 1px solid #e2e6ea;
  border-radius: 8px;
  padding: 8px;
  background: #fafbfc;
}

.scan-select {
  width: 100%;
  font-size: 12px;
  padding: 4px;
  margin-bottom: 6px;
  border: 1px solid #d8dde2;
  border-radius: 4px;
}

.scan-row {
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: #667;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.scan-row input[type='number'] {
  width: 56px;
  font-size: 11px;
  padding: 2px 4px;
  border: 1px solid #d8dde2;
  border-radius: 4px;
}

.scan-row input[type='range'] {
  width: 60px;
  accent-color: #3e6fb0;
}

.scan-result {
  margin-top: 8px;
  font-size: 11px;
}

.scan-opt {
  background: #eaf0fa;
  color: #2d5a96;
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 6px;
  font-family: Consolas, monospace;
}

.controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.btn {
  padding: 6px 18px;
  font-size: 13px;
  background: #eef1f4;
  color: #333;
}

.btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.btn.primary {
  background: #3f8f79;
  color: #fff;
}

.status {
  font-size: 11px;
  color: #aaa;
  margin-left: auto;
}

.live {
  margin-top: 8px;
  font-size: 12px;
  font-family: Consolas, monospace;
  color: #3e6fb0;
  background: #eaf0fa;
  border-radius: 6px;
  padding: 6px 10px;
}

.mode-row {
  display: flex;
  gap: 14px;
  margin-top: 10px;
}

.mode-check {
  font-size: 12px;
  color: #556;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.mode-check input {
  accent-color: #3e6fb0;
}

.manual-tip {
  margin-top: 6px;
  font-size: 11px;
  color: #8a5fb8;
  background: #f3ecfa;
  border-radius: 6px;
  padding: 5px 8px;
}

.result {
  margin-top: 10px;
  background: #eaf5f0;
  border-radius: 8px;
  padding: 10px 12px;
}

.result-line {
  font-size: 12px;
  color: #2c6e5c;
  font-family: Consolas, monospace;
  line-height: 1.8;
}

.guide {
  font-size: 12px;
  color: #667;
  line-height: 1.7;
}
</style>
