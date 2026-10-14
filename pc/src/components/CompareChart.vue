<script setup lang="ts">
import { onMounted, watch, ref, computed } from 'vue'
import type { RecordColumn, Row } from '../experiments/types'

/**
 * V2 对照实验数据对比图（T3）：A/B 两组数据同图双色渲染。
 */
export interface CompareSet {
  title: string
  columns: RecordColumn[]
  rows: Row[]
  curve: { x: string; y: string; title: string } | null
}

const props = defineProps<{
  setA: CompareSet | null
  setB: CompareSet | null
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

const valid = computed(() => {
  const mk = (s: CompareSet | null): { xs: number[]; ys: number[] } | null => {
    if (!s || !s.curve || s.rows.length === 0) return null
    const xi = s.columns.findIndex((c) => c.id === s.curve!.x)
    const yi = s.columns.findIndex((c) => c.id === s.curve!.y)
    if (xi < 0 || yi < 0) return null
    const xs: number[] = []
    const ys: number[] = []
    for (const r of s.rows) {
      if (xi < r.length && yi < r.length) {
        xs.push(r[xi])
        ys.push(r[yi])
      }
    }
    return xs.length > 0 ? { xs, ys } : null
  }
  return { a: mk(props.setA), b: mk(props.setB) }
})

function draw(): void {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = w * dpr
  canvas.height = h * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const v = valid.value
  const allX: number[] = []
  const allY: number[] = []
  if (v.a) allX.push(...v.a.xs), allY.push(...v.a.ys)
  if (v.b) allX.push(...v.b.xs), allY.push(...v.b.ys)

  ctx.fillStyle = '#f7f9fa'
  ctx.fillRect(0, 0, w, h)
  if (allX.length === 0) {
    ctx.fillStyle = '#999'
    ctx.font = '13px sans-serif'
    ctx.fillText('两组实验均无曲线数据，请先在两侧各自完成测量', 16, h / 2)
    return
  }

  let minX = Math.min(...allX)
  let maxX = Math.max(...allX)
  let minY = Math.min(...allY)
  let maxY = Math.max(...allY)
  if (maxX - minX < 1e-9) maxX = minX + 1
  if (maxY - minY < 1e-9) maxY = minY + 1
  const pad = { l: 48, r: 16, t: 20, b: 28 }
  const pw = w - pad.l - pad.r
  const ph = h - pad.t - pad.b
  const X = (n: number): number => pad.l + ((n - minX) / (maxX - minX)) * pw
  const Y = (n: number): number => pad.t + ph - ((n - minY) / (maxY - minY)) * ph

  ctx.strokeStyle = '#e2e6ea'
  ctx.fillStyle = '#889'
  ctx.font = '10px sans-serif'
  for (let i = 0; i <= 4; i++) {
    const gx = pad.l + (pw * i) / 4
    ctx.beginPath(); ctx.moveTo(gx, pad.t); ctx.lineTo(gx, pad.t + ph); ctx.stroke()
    ctx.fillText((minX + ((maxX - minX) * i) / 4).toFixed(1), gx - 8, h - 10)
    const gy = pad.t + (ph * i) / 4
    ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(pad.l + pw, gy); ctx.stroke()
    ctx.fillText((maxY - ((maxY - minY) * i) / 4).toFixed(1), 8, gy + 3)
  }

  const plot = (data: { xs: number[]; ys: number[] } | null, color: string): void => {
    if (!data) return
    ctx.fillStyle = color
    for (let i = 0; i < data.xs.length; i++) {
      ctx.beginPath()
      ctx.arc(X(data.xs[i]), Y(data.ys[i]), 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  plot(v.a, '#3f8f79')
  plot(v.b, '#c04545')

  ctx.font = '12px sans-serif'
  ctx.fillStyle = '#3f8f79'
  ctx.fillText('● A ' + (props.setA?.title ?? ''), pad.l, 14)
  ctx.fillStyle = '#c04545'
  ctx.fillText('● B ' + (props.setB?.title ?? ''), pad.l + 130, 14)
}

onMounted(draw)
watch(() => [props.setA, props.setB], draw, { deep: true })
</script>

<template>
  <div class="compare-chart">
    <canvas ref="canvasRef"></canvas>
  </div>
</template>

<style scoped>
.compare-chart {
  width: 100%;
  height: 100%;
}

.compare-chart canvas {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 8px;
}
</style>
