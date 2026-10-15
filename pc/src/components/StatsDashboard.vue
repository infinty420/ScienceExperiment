<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { SUBJECTS } from '../data/experiments'
import type { HistoryEntry } from '../store/history'

/**
 * V3 成绩分析看板：学科分布 / 考核得分趋势 / 薄弱实验识别。
 * 纯 canvas 自绘，不引图表库，保持离线零依赖。
 */
const props = defineProps<{ history: HistoryEntry[] }>()

const exams = computed(() => props.history.filter((h) => h.mode === 'exam'))
const practices = computed(() => props.history.filter((h) => h.mode !== 'exam'))
const avgScore = computed(() => {
  const s = exams.value.map((e) => e.score ?? 0)
  return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : 0
})
const bestScore = computed(() => {
  const s = exams.value.map((e) => e.score ?? 0)
  return s.length ? Math.max(...s) : 0
})
const weak = computed(() =>
  exams.value
    .filter((e) => (e.score ?? 100) < 80)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 6)
)
const subjectCount = computed(() =>
  SUBJECTS.map((s) => ({ ...s, n: props.history.filter((h) => h.subject === s.key).length }))
)

const barRef = ref<HTMLCanvasElement | null>(null)
const trendRef = ref<HTMLCanvasElement | null>(null)

function ctx2d(c: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!c) return null
  const dpr = window.devicePixelRatio || 1
  const w = c.clientWidth || 600
  const h = c.clientHeight || 200
  if (c.width !== w * dpr || c.height !== h * dpr) {
    c.width = w * dpr
    c.height = h * dpr
  }
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return ctx
}

function drawBars(): void {
  const ctx = ctx2d(barRef.value)
  if (!ctx) return
  const w = barRef.value!.clientWidth || 600
  const h = barRef.value!.clientHeight || 200
  const max = Math.max(1, ...subjectCount.value.map((s) => s.n))
  const pad = { l: 34, r: 10, t: 14, b: 26 }
  const bw = (w - pad.l - pad.r) / subjectCount.value.length
  ctx.font = '11px Consolas, monospace'
  // y 轴刻度
  ctx.fillStyle = '#99a'
  ctx.strokeStyle = '#e4e8ec'
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i
    const y = h - pad.b - ((h - pad.t - pad.b) * i) / 4
    ctx.fillText(String(Math.round(v)), 6, y + 4)
    ctx.beginPath()
    ctx.moveTo(pad.l, y)
    ctx.lineTo(w - pad.r, y)
    ctx.stroke()
  }
  subjectCount.value.forEach((s, i) => {
    const bh = ((h - pad.t - pad.b) * s.n) / max
    const x = pad.l + i * bw + bw * 0.18
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.roundRect(x, h - pad.b - bh, bw * 0.64, Math.max(bh, s.n > 0 ? 3 : 0), 4)
    ctx.fill()
    ctx.fillStyle = '#556'
    ctx.font = '12px system-ui'
    const label = `${s.label}`
    ctx.fillText(label, x + bw * 0.32 - (label.length * 6) / 2, h - 8)
    if (s.n > 0) {
      ctx.fillStyle = s.color
      ctx.font = 'bold 12px Consolas, monospace'
      ctx.fillText(String(s.n), x + bw * 0.32 - 4, h - pad.b - bh - 5)
    }
  })
}

function drawTrend(): void {
  const ctx = ctx2d(trendRef.value)
  if (!ctx) return
  const w = trendRef.value!.clientWidth || 600
  const h = trendRef.value!.clientHeight || 200
  const data = [...exams.value].sort((a, b) => a.date.localeCompare(b.date))
  const pad = { l: 34, r: 14, t: 14, b: 26 }
  ctx.font = '11px Consolas, monospace'
  ctx.fillStyle = '#99a'
  ctx.strokeStyle = '#e4e8ec'
  for (let i = 0; i <= 4; i++) {
    const v = 25 * i
    const y = h - pad.b - ((h - pad.t - pad.b) * i) / 4
    ctx.fillText(String(v), 8, y + 4)
    ctx.beginPath()
    ctx.moveTo(pad.l, y)
    ctx.lineTo(w - pad.r, y)
    ctx.stroke()
  }
  if (data.length === 0) {
    ctx.fillStyle = '#aab'
    ctx.font = '13px system-ui'
    ctx.fillText('暂无考核记录 —— 进入实验开启「考核模式」即可积累成绩', pad.l + 20, h / 2)
    return
  }
  const X = (i: number): number =>
    data.length === 1 ? (pad.l + w - pad.r) / 2 : pad.l + ((w - pad.l - pad.r) * i) / (data.length - 1)
  const Y = (s: number): number => h - pad.b - ((h - pad.t - pad.b) * s) / 100
  // 折线
  ctx.strokeStyle = '#3f8f79'
  ctx.lineWidth = 2
  ctx.beginPath()
  data.forEach((e, i) => {
    const y = Y(e.score ?? 0)
    if (i === 0) ctx.moveTo(X(i), y)
    else ctx.lineTo(X(i), y)
  })
  ctx.stroke()
  // 数据点
  data.forEach((e, i) => {
    const s = e.score ?? 0
    ctx.fillStyle = s >= 80 ? '#3f8f79' : s >= 60 ? '#c8963e' : '#c05a5a'
    ctx.beginPath()
    ctx.arc(X(i), Y(s), 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#556'
    ctx.font = '10px system-ui'
    const short = e.title.length > 6 ? e.title.slice(0, 5) + '…' : e.title
    if (data.length <= 8 || i % Math.ceil(data.length / 8) === 0) {
      ctx.fillText(short, X(i) - 18, h - 8)
    }
  })
}

function redraw(): void {
  drawBars()
  drawTrend()
}

onMounted(() => redraw())
watch(() => props.history, () => redraw(), { deep: true })
</script>

<template>
  <div class="dashboard">
    <!-- 概览卡片 -->
    <div class="stat-cards">
      <div class="stat-card">
        <div class="stat-num">{{ history.length }}</div>
        <div class="stat-label">完成实验</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ practices.length }}</div>
        <div class="stat-label">练习次数</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ exams.length }}</div>
        <div class="stat-label">考核次数</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" :class="{ good: avgScore >= 80, warn: avgScore > 0 && avgScore < 60 }">{{ avgScore }}</div>
        <div class="stat-label">考核均分</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ bestScore }}</div>
        <div class="stat-label">最高分</div>
      </div>
    </div>

    <!-- 图表区 -->
    <div class="charts">
      <div class="chart-box">
        <div class="chart-title">学科完成分布</div>
        <canvas ref="barRef" class="chart-canvas"></canvas>
      </div>
      <div class="chart-box">
        <div class="chart-title">考核成绩趋势（按时间）</div>
        <canvas ref="trendRef" class="chart-canvas"></canvas>
      </div>
    </div>

    <!-- 薄弱实验 -->
    <div class="weak-box" v-if="weak.length">
      <div class="chart-title">薄弱实验（考核 &lt; 80 分，建议重做）</div>
      <div class="weak-list">
        <div v-for="wgh in weak" :key="wgh.experimentId" class="weak-item">
          <span class="weak-score" :class="{ bad: (wgh.score ?? 0) < 60 }">{{ wgh.score ?? '-' }}</span>
          <span class="weak-title">{{ wgh.title }}</span>
          <span class="weak-date">{{ wgh.date.slice(0, 10) }}</span>
        </div>
      </div>
    </div>
    <div class="weak-box ok" v-else-if="exams.length">
      <div class="chart-title ok-title">✓ 暂无薄弱实验——所有考核成绩均在 80 分以上，保持！</div>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 8px 28px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
}

.stat-card {
  background: #fff;
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  text-align: center;
}

.stat-num {
  font-size: 26px;
  font-weight: 700;
  color: #33475b;
  font-family: Consolas, monospace;
}

.stat-num.good {
  color: #3f8f79;
}

.stat-num.warn {
  color: #c05a5a;
}

.stat-label {
  font-size: 12px;
  color: #99a;
  margin-top: 2px;
}

.charts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.chart-box {
  background: #fff;
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

.chart-title {
  font-size: 13px;
  font-weight: 600;
  color: #556;
  margin-bottom: 6px;
}

.chart-canvas {
  width: 100%;
  height: 190px;
  display: block;
}

.weak-box {
  background: #fff;
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

.weak-box.ok {
  padding: 16px;
}

.ok-title {
  color: #3f8f79;
}

.weak-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.weak-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #faf5ef;
  border-radius: 8px;
}

.weak-score {
  width: 40px;
  height: 28px;
  border-radius: 6px;
  background: #c8963e;
  color: #fff;
  font-weight: 700;
  font-family: Consolas, monospace;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.weak-score.bad {
  background: #c05a5a;
}

.weak-title {
  flex: 1;
  font-size: 13px;
  color: #33475b;
}

.weak-date {
  font-size: 12px;
  color: #99a;
}
</style>
