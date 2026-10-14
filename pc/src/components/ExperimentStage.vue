<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { Engine } from '../engine/core'
import { getSceneDef, buildExperiment } from '../experiments/loader'
import type { PhysicsWorld } from '../engine/physics'
import type { ExperimentLogic, ParamDef, RecordColumn, Row } from '../experiments/types'
import DataPanel from './DataPanel.vue'

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
  if (type === 'result') {
    resultLines.value = payload.lines as string[]
    state.value = 'done'
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
</script>

<template>
  <div class="stage">
    <div class="toolbar">
      <button class="back" @click="emit('back')">‹ 返回</button>
      <span class="title">{{ title }}</span>
      <span class="fps" :class="{ ok: fps > 0 }">{{ fps > 0 ? `${fps} FPS` : '…' }}</span>
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
