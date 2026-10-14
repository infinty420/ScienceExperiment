<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import * as THREE from 'three'
import { Engine } from '../engine/core'
import { getSceneDef, buildExperiment } from '../experiments/loader'
import type { PhysicsWorld } from '../engine/physics'
import type { ExperimentLogic, ParamDef, RecordColumn, Row } from '../experiments/types'
import DataPanel from './DataPanel.vue'
import { saveHistory } from '../store/history'
import { searchFaq } from '../data/faq'

const props = defineProps<{ experimentId: string; title: string }>()
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

let engine: Engine | null = null
let physics: PhysicsWorld | null = null
let logic: ExperimentLogic | null = null

function post(type: string, payload: Record<string, unknown>): void {
  if (type === 'fps') {
    fps.value = payload.fps as number
    return
  }
  if (type === 'data') {
    rows.value.push(payload.row as number[])
    return
  }
  if (type === 'rows') {
    rows.value = payload.rows as number[][]
    return
  }
  if (type === 'result') {
    resultLines.value = payload.lines as string[]
    state.value = 'done'
    // W8：保存历史成绩
    const def = getSceneDef(props.experimentId)
    if (def) {
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
    }
    return
  }
  if (type === 'theory') {
    theory.value = { points: payload.points as Array<[number, number]>, label: payload.label as string }
    return
  }
  if (type === 'note') {
    noteText.value = payload.text as string
    return
  }
  if (type === 'live') {
    const i = payload.current as number
    const p = payload.lampPower as number
    liveText.value = `电流 I = ${i.toFixed(3)} A · 灯泡功率 P = ${p.toFixed(2)} W`
  }
}

onMounted(() => {
  const canvas = document.getElementById('stage-canvas') as HTMLCanvasElement | null
  if (!canvas) return

  engine = new Engine(canvas)
  engine.onPost = post

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
  status.value = '就绪'

  // 主循环：物理步进 + 实验逻辑
  engine.updatables.push((dt: number) => {
    physics?.step(dt)
    logic?.update(dt)
  })
})

onUnmounted(() => {
  logic?.dispose()
  physics?.dispose()
  engine?.dispose()
  engine = null
  physics = null
  logic = null
})

function onParam(p: ParamDef, value: number): void {
  paramValues.value[p.id] = value
  logic?.onParam(p.id, value)
  // 参数改变即回到待运行
  if (state.value !== 'idle') {
    state.value = 'idle'
    rows.value = []
    resultLines.value = []
    theory.value = null
    noteText.value = ''
  }
}

function start(): void {
  if (state.value === 'running') return
  if (state.value !== 'paused') {
    rows.value = []
    resultLines.value = []
    theory.value = null
    noteText.value = ''
  }
  logic?.start()
  state.value = 'running'
}

function pause(): void {
  logic?.pause()
  state.value = 'paused'
}

function reset(): void {
  logic?.reset()
  state.value = 'idle'
  rows.value = []
  resultLines.value = []
  theory.value = null
  noteText.value = ''
}

/** W6：导出实验报告（自包含 HTML，可打印转 PDF） */
function exportReport(): void {
  const def = getSceneDef(props.experimentId)
  const chartCanvas = document.querySelector('.data-panel .chart') as HTMLCanvasElement | null
  const chartImg = chartCanvas ? chartCanvas.toDataURL('image/png') : ''
  const paramRows = params.value
    .map((p) => `<tr><td>${p.label}</td><td>${paramValues.value[p.id] ?? '—'} ${p.unit ?? ''}</td></tr>`)
    .join('')
  const dataRows = rows.value
    .map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`)
    .join('')
  const headCells = columns.value.map((c) => `<th>${c.label}</th>`).join('')
  const resultHtml = resultLines.value.map((l) => `<li>${l}</li>`).join('')
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>实验报告 - ${props.title}</title>
<style>body{font-family:'Microsoft YaHei',sans-serif;max-width:800px;margin:24px auto;color:#222;padding:0 16px}
h1{font-size:22px;border-bottom:2px solid #3f8f79;padding-bottom:8px}h2{font-size:16px;color:#3f8f79;margin-top:20px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:5px 9px;text-align:left}
th{background:#eaf5f0}img{max-width:100%;border:1px solid #eee}li{line-height:1.9;margin:4px 0}</style></head><body>
<h1>智实验 SciLab · 实验报告</h1>
<p>实验名称：${props.title} ｜ 完成时间：${new Date().toLocaleString('zh-CN')} ｜ 记录 ${rows.value.length} 组数据</p>
<h2>一、实验参数</h2><table><tr><th>参数</th><th>取值</th></tr>${paramRows || '<tr><td colspan="2">无</td></tr>'}</table>
<h2>二、数据记录</h2><table><tr>${headCells}</tr>${dataRows || '<tr><td colspan="9">（无数据）</td></tr>'}</table>
${chartImg ? `<h2>三、曲线</h2><img src="${chartImg}" alt="curve">` : ''}
<h2>四、结论</h2><ol>${resultHtml || '<li>（未生成结论，请完成实验）</li>'}</ol>
${def?.guide ? `<h2>五、实验原理</h2><p style="line-height:1.8;color:#555">${def.guide}</p>` : ''}
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

/** 导出数据 CSV */
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

/** W9：本地 AI 助教（检索式知识库 + 分步引导） */
const aiOpen = ref(false)
const aiQuestion = ref('')
const aiAnswer = ref('')
const aiHit = ref(false)
const aiTab = ref<'qa' | 'steps'>('qa')

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
    `${(fromGuide.length ?? 0) + 3}. 点击「开始」运行并观察 3D 现象与曲线`,
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
</script>

<template>
  <div class="stage">
    <div class="toolbar">
      <button class="back" @click="emit('back')">‹ 返回</button>
      <span class="title">{{ title }}</span>
      <button class="tool-btn" @click="exportReport">导出报告</button>
      <button class="tool-btn" @click="exportCsv" v-if="columns.length">导出 CSV</button>
      <button class="tool-btn" @click="aiOpen = true">AI 助教</button>
      <span class="fps" :class="{ ok: fps > 0 }">{{ fps > 0 ? `${fps} FPS` : '…' }}</span>
    </div>

    <!-- AI 助教弹窗 -->
    <div class="ai-mask" v-if="aiOpen" @click.self="aiOpen = false">
      <div class="ai-dialog">
        <div class="ai-head">
          <span>AI 助教 · 本地知识库（离线）</span>
          <button class="ai-close" @click="aiOpen = false">✕</button>
        </div>
        <div class="ai-tabs">
          <button :class="{ tab: true, on: aiTab === 'qa' }" @click="aiTab = 'qa'">答疑</button>
          <button :class="{ tab: true, on: aiTab === 'steps' }" @click="aiTab = 'steps'">实验步骤</button>
        </div>
        <div class="ai-body" v-if="aiTab === 'qa'">
          <div class="ai-ask">
            <input v-model="aiQuestion" placeholder="例如：为什么实测值有误差？" @keyup.enter="askAi" />
            <button class="btn primary" @click="askAi">提问</button>
          </div>
          <div class="ai-answer" v-if="aiAnswer" :class="{ miss: !aiHit }">{{ aiAnswer }}</div>
          <div class="ai-tip" v-else>可尝试：误差原因 / 怎么调视角 / 数据怎么导出，以及本实验专属问题</div>
        </div>
        <div class="ai-body" v-else>
          <ol class="steps-list">
            <li v-for="(s, i) in guideSteps" :key="i">{{ s }}</li>
          </ol>
        </div>
      </div>
    </div>

    <div class="body">
      <div class="canvas-wrap">
        <canvas id="stage-canvas"></canvas>
        <div class="hud">拖拽旋转 · 滚轮缩放</div>
        <div class="note" v-if="noteText">{{ noteText }}</div>
      </div>

      <aside class="side">
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
              @input="onParam(p, Number(($event.target as HTMLInputElement).value))"
            />
          </div>
          <div v-if="params.length === 0" class="empty">无参数</div>
        </section>

        <section class="sec">
          <h3>控制</h3>
          <div class="controls">
            <button class="btn primary" :disabled="state === 'running'" @click="start">
              {{ state === 'paused' ? '继续' : '开始' }}
            </button>
            <button class="btn" :disabled="state !== 'running'" @click="pause">暂停</button>
            <button class="btn" @click="reset">重置</button>
            <span class="status">{{ status }}</span>
          </div>
          <div class="live" v-if="liveText">{{ liveText }}</div>
          <div class="result" v-if="resultLines.length">
            <div v-for="(l, i) in resultLines" :key="i" class="result-line">{{ l }}</div>
          </div>
        </section>

        <section class="sec grow">
          <h3>数据记录</h3>
          <DataPanel :columns="columns" :rows="rows" :curve="curveDef" :theory="theory" />
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
  margin-left: 14px;
  padding: 4px 12px;
  font-size: 12px;
  background: #eef1f4;
  color: #445;
}

.tool-btn:hover {
  background: #dfe6ec;
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
  width: 400px;
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

#stage-canvas {
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
