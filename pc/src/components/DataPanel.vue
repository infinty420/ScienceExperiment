<script setup lang="ts">
import { watch, ref, onMounted } from 'vue'

/**
 * 数据面板：记录表格 + 曲线（实测散点 + 可选理论曲线）。
 * 自绘 canvas，不引图表库。
 */
const props = defineProps<{
  columns: Array<{ id: string; label: string; digits?: number }>
  rows: number[][]
  curve?: { x: string; y: string; title: string } | null
  theory?: { points: Array<[number, number]>; label: string } | null
}>()

const emit = defineEmits<{
  (e: 'fit', r2: number): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const fitEnabled = ref(false)
const fitInfo = ref<string | null>(null)

/** 最小二乘线性拟合 */
function linearFit(pts: Array<[number, number]>): { a: number; b: number; r2: number } | null {
  const n = pts.length
  if (n < 3) return null
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0
  for (const [x, y] of pts) {
    sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y
  }
  const d = n * sxx - sx * sx
  if (Math.abs(d) < 1e-12) return null
  const a = (n * sxy - sx * sy) / d
  const b = (sy - a * sx) / n
  const ym = sy / n
  const ssTot = syy - n * ym * ym
  const ssRes = pts.reduce((s, [x, y]) => s + (y - (a * x + b)) ** 2, 0)
  const r2 = ssTot > 1e-12 ? 1 - ssRes / ssTot : 1
  return { a, b, r2 }
}

function fmt(v: number, digits?: number): string {
  const d = digits ?? 2
  return v.toFixed(d)
}

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr
    canvas.height = h * dpr
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const cv = props.curve
  if (!cv) {
    ctx.fillStyle = '#999'
    ctx.font = '12px sans-serif'
    ctx.fillText('（该实验无曲线）', 12, 24)
    return
  }

  const xi = props.columns.findIndex((c) => c.id === cv.x)
  const yi = props.columns.findIndex((c) => c.id === cv.y)
  const xs: number[] = []
  const ys: number[] = []
  for (const r of props.rows) {
    if (xi < r.length && yi < r.length) {
      xs.push(r[xi])
      ys.push(r[yi])
    }
  }
  const theory = props.theory?.points ?? []
  for (const [tx, ty] of theory) {
    xs.push(tx)
    ys.push(ty)
  }
  if (xs.length === 0) {
    ctx.fillStyle = '#999'
    ctx.font = '12px sans-serif'
    ctx.fillText('开始实验后显示曲线', 12, 24)
    return
  }

  let minX = Math.min(...xs)
  let maxX = Math.max(...xs)
  let minY = Math.min(...ys)
  let maxY = Math.max(...ys)
  if (maxX - minX < 1e-9) maxX = minX + 1
  if (maxY - minY < 1e-9) {
    maxY = minY + 1
    minY -= 1
  }
  const pad = { l: 44, r: 12, t: 26, b: 26 }
  const pw = w - pad.l - pad.r
  const ph = h - pad.t - pad.b
  const X = (v: number): number => pad.l + ((v - minX) / (maxX - minX)) * pw
  const Y = (v: number): number => pad.t + ph - ((v - minY) / (maxY - minY)) * ph

  // 背景
  ctx.fillStyle = '#f7f9fa'
  ctx.fillRect(pad.l, pad.t, pw, ph)

  // 网格与坐标
  ctx.strokeStyle = '#e2e6ea'
  ctx.fillStyle = '#889'
  ctx.font = '10px sans-serif'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const gx = pad.l + (pw * i) / 4
    ctx.beginPath()
    ctx.moveTo(gx, pad.t)
    ctx.lineTo(gx, pad.t + ph)
    ctx.stroke()
    const vx = minX + ((maxX - minX) * i) / 4
    ctx.fillText(vx.toFixed(1), gx - 10, h - 10)
    const gy = pad.t + (ph * i) / 4
    ctx.beginPath()
    ctx.moveTo(pad.l, gy)
    ctx.lineTo(pad.l + pw, gy)
    ctx.stroke()
    const vy = maxY - ((maxY - minY) * i) / 4
    ctx.fillText(vy.toFixed(1), 6, gy + 3)
  }

  // 理论曲线（连续线）
  if (theory.length > 1) {
    ctx.strokeStyle = '#e07a3e'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    theory.forEach(([tx, ty], i) => {
      const px = X(tx)
      const py = Y(ty)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.stroke()
  }

  // 实测散点 + 误差棒（V2：该列声明了 sigma 时绘制 ±σ 竖线）
  const ySigma = props.columns[yi]?.sigma ?? 0
  for (const r of props.rows) {
    if (xi < r.length && yi < r.length) {
      if (ySigma > 0) {
        ctx.strokeStyle = 'rgba(63, 143, 121, 0.5)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(X(r[xi]), Y(r[yi] - ySigma))
        ctx.lineTo(X(r[xi]), Y(r[yi] + ySigma))
        ctx.stroke()
      }
      ctx.fillStyle = '#3f8f79'
      ctx.beginPath()
      ctx.arc(X(r[xi]), Y(r[yi]), 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // 拟合线（红色虚线，覆盖数据 x 范围）
  if (fitEnabled.value) {
    const pts = props.rows
      .filter((r) => xi < r.length && yi < r.length)
      .map((r) => [r[xi], r[yi]] as [number, number])
    const fit = linearFit(pts)
    if (fit) {
      fitInfo.value = `y = ${fit.a.toFixed(4)}·x ${fit.b >= 0 ? '+' : '−'} ${Math.abs(fit.b).toFixed(4)}    R² = ${fit.r2.toFixed(4)}`
      emit('fit', fit.r2)
      const x1 = minX
      const x2 = maxX
      ctx.strokeStyle = '#d04545'
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(X(x1), Y(fit.a * x1 + fit.b))
      ctx.lineTo(X(x2), Y(fit.a * x2 + fit.b))
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#d04545'
      ctx.font = '11px monospace'
      ctx.fillText(fitInfo.value, pad.l + 6, pad.t + ph - 8)
    } else {
      fitInfo.value = '数据不足（≥3 点）'
    }
  }

  // 标题与图例
  ctx.fillStyle = '#333'
  ctx.font = '12px sans-serif'
  ctx.fillText(cv.title, pad.l, 16)
  let lx = pad.l + 4
  const ly = pad.t + 12
  ctx.fillStyle = '#3f8f79'
  ctx.beginPath()
  ctx.arc(lx + 4, ly - 4, 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#555'
  ctx.font = '10px sans-serif'
  ctx.fillText('实测', lx + 10, ly)
  if (props.theory) {
    lx += 52
    ctx.strokeStyle = '#e07a3e'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(lx, ly - 4)
    ctx.lineTo(lx + 16, ly - 4)
    ctx.stroke()
    ctx.fillStyle = '#555'
    ctx.fillText(props.theory.label, lx + 20, ly)
  }
}

watch(() => [props.rows, props.theory], () => draw(), { deep: true })
onMounted(() => draw())
defineExpose({ redraw: draw, fitResult: fitInfo })
</script>

<template>
  <div class="data-panel">
    <div class="panel-head" v-if="curve">
      <span class="fit-status" v-if="fitEnabled && fitInfo">{{ fitInfo }}</span>
      <button class="fit-btn" :class="{ on: fitEnabled }" @click="fitEnabled = !fitEnabled; draw()">
        线性拟合 {{ fitEnabled ? '✓' : '' }}
      </button>
    </div>
    <div class="table-wrap" v-if="columns.length > 0">
      <table>
        <thead>
          <tr>
            <th v-for="c in columns" :key="c.id">{{ c.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows.slice(-60).reverse()" :key="i">
            <td v-for="(v, j) in r" :key="j">{{ fmt(v, columns[j]?.digits) }}</td>
          </tr>
        </tbody>
      </table>
      <div class="hint" v-if="rows.length === 0">开始实验后记录数据（显示最近 60 行）</div>
    </div>
    <canvas ref="canvasRef" class="chart"></canvas>
  </div>
</template>

<style scoped>
.data-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  font-size: 12px;
  color: #889;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.fit-status {
  font-size: 10px;
  font-family: Consolas, monospace;
  color: #d04545;
}

.fit-btn {
  font-size: 11px;
  padding: 3px 10px;
  background: #eef1f4;
  color: #556;
  border-radius: 4px;
}

.fit-btn.on {
  background: #d04545;
  color: #fff;
}

.table-wrap {
  overflow: auto;
  border: 1px solid #e5e7ea;
  border-radius: 6px;
  max-height: 180px;
  min-height: 60px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-family: Consolas, monospace;
}

th {
  position: sticky;
  top: 0;
  background: #eef1f4;
  color: #556;
  font-weight: 500;
  padding: 4px 8px;
  text-align: right;
  white-space: nowrap;
}

td {
  padding: 3px 8px;
  text-align: right;
  border-top: 1px solid #f0f2f4;
  color: #334;
}

.hint {
  padding: 10px;
  color: #aaa;
  font-size: 11px;
  text-align: center;
}

.chart {
  width: 100%;
  height: 170px;
  border: 1px solid #e5e7ea;
  border-radius: 6px;
  background: #fff;
}
</style>
