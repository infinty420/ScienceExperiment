<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import type { InstrumentDef } from '../experiments/types'
import { gaussNoise, sigmaOf } from '../engine/stat'

/**
 * V2 虚拟仪器面板（T2）
 * - 秒表：真实启停交互，读数含 ±0.2s 人手反应延迟（高斯）
 * - 其他仪器：基于实验推送的真值 + 仪器级高斯噪声"读数"
 * 学生读数 → emit('record', {colId: 含噪值}) → 实验台组装数据行
 */
const props = defineProps<{
  instruments: InstrumentDef[]
  /** 实验逻辑当前推送的真值（colId → trueValue） */
  trueValues: Record<string, number>
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'record', readings: Record<string, number>): void
  (e: 'over-range', instrument: InstrumentDef, value: number): void
}>()

/* ───── 秒表 ───── */
const swRunning = ref(false)
const swDisplay = ref(0)
const swStartAt = ref(0)
let swTimer: ReturnType<typeof setInterval> | null = null

function swToggle(): void {
  if (swRunning.value) {
    if (swTimer) clearInterval(swTimer)
    swTimer = null
    swRunning.value = false
  } else {
    swStartAt.value = performance.now() - swDisplay.value * 1000
    swRunning.value = true
    swTimer = setInterval(() => {
      swDisplay.value = (performance.now() - swStartAt.value) / 1000
    }, 31)
  }
}

function swReset(): void {
  if (swTimer) clearInterval(swTimer)
  swTimer = null
  swRunning.value = false
  swDisplay.value = 0
}

/** 秒表计次读数：显示值 + 反应延迟噪声 */
function swLap(inst: InstrumentDef): void {
  const sigma = sigmaOf('stopwatch')
  let reading = swDisplay.value + gaussNoise(sigma)
  if (reading < 0) reading = 0
  if (checkRange(inst, reading)) emit('record', { [inst.recordColumn ?? inst.id]: +reading.toFixed(2) })
}

onUnmounted(() => {
  if (swTimer) clearInterval(swTimer)
})

/* ───── 其他仪器 ───── */
function read(inst: InstrumentDef): void {
  const col = inst.recordColumn ?? inst.id
  const tv = props.trueValues[col]
  if (tv === undefined || tv === null || Number.isNaN(tv)) return
  const sigma = inst.type === 'ruler' ? sigmaOf('ruler') : sigmaOf(inst.type)
  const reading = +(tv + gaussNoise(sigma)).toFixed(inst.digits ?? 2)
  if (checkRange(inst, reading)) emit('record', { [col]: reading })
}

/** 量程检查：电表类超量程"打表"，不产生有效读数 */
function checkRange(inst: InstrumentDef, value: number): boolean {
  if (inst.range) {
    const [lo, hi] = inst.range
    if (value < lo || value > hi) {
      emit('over-range', inst, value)
      return false
    }
  }
  return true
}

function fmtStopwatch(v: number): string {
  return v.toFixed(2).padStart(6, '0')
}
</script>

<template>
  <div class="instruments">
    <template v-for="inst in instruments" :key="inst.id">
      <!-- 秒表：独立交互 -->
      <div v-if="inst.type === 'stopwatch'" class="inst stopwatch">
        <div class="inst-label">⏱ {{ inst.label }}</div>
        <div class="sw-display">{{ fmtStopwatch(swDisplay) }}<span class="sw-unit">s</span></div>
        <div class="sw-btns">
          <button class="sw-btn" :class="{ run: swRunning }" @click="swToggle">
            {{ swRunning ? '停止' : '启动' }}
          </button>
          <button class="sw-btn" :disabled="swRunning" @click="swReset">归零</button>
          <button class="sw-btn primary" :disabled="disabled || swRunning" @click="swLap(inst)" title="读数并记录（含 ±0.2s 反应误差）">
            计次读数
          </button>
        </div>
        <div class="inst-tip">看 3D 摆动自行掐表 · 读数含人手反应延迟</div>
      </div>

      <!-- 其他仪器：读数按钮 -->
      <div v-else class="inst">
        <div class="inst-label">
          {{ inst.type === 'ruler' ? '📏' : inst.type === 'graduatedCylinder' ? '🧪' : inst.type === 'thermometer' ? '🌡' : inst.type === 'ammeter' ? '⚡' : inst.type === 'voltmeter' ? '⚡' : '⚖' }}
          {{ inst.label }}
        </div>
        <div class="inst-reading">
          <span class="inst-value">{{ trueValues[inst.recordColumn ?? inst.id] !== undefined ? trueValues[inst.recordColumn ?? inst.id].toFixed(inst.digits ?? 2) : '—' }}</span>
          <span class="inst-unit" v-if="inst.unit">{{ inst.unit }}</span>
          <button class="sw-btn primary" :disabled="disabled" @click="read(inst)" title="读数并记录（含仪器误差）">
            读数记录
          </button>
        </div>
        <div class="inst-tip" v-if="inst.range">
          量程 {{ inst.range[0] }} ~ {{ inst.range[1] }} {{ inst.unit ?? '' }} · 超量程打表
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.instruments {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.inst {
  border: 1px solid #e2e6ea;
  border-radius: 8px;
  padding: 8px 10px;
  background: #fafbfc;
}

.inst-label {
  font-size: 12px;
  color: #556;
  font-weight: 600;
  margin-bottom: 6px;
}

.sw-display {
  font-family: Consolas, monospace;
  font-size: 26px;
  color: #22303c;
  background: #22303c;
  color: #7ef0c0;
  border-radius: 6px;
  padding: 6px 12px;
  text-align: center;
  letter-spacing: 2px;
  margin-bottom: 6px;
}

.sw-unit {
  font-size: 12px;
  margin-left: 6px;
  color: #5a8a7a;
}

.sw-btns {
  display: flex;
  gap: 6px;
}

.sw-btn {
  flex: 1;
  font-size: 12px;
  padding: 5px 0;
  border: 1px solid #d8dde2;
  border-radius: 6px;
  background: #fff;
  color: #445;
  cursor: pointer;
}

.sw-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.sw-btn.run {
  border-color: #c04545;
  color: #c04545;
}

.sw-btn.primary {
  background: #3f8f79;
  border-color: #3f8f79;
  color: #fff;
}

.inst-reading {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inst-value {
  font-family: Consolas, monospace;
  font-size: 16px;
  color: #22303c;
  min-width: 64px;
  text-align: right;
}

.inst-unit {
  font-size: 11px;
  color: #889;
}

.inst-reading .sw-btn {
  flex: none;
  padding: 5px 12px;
}

.inst-tip {
  margin-top: 5px;
  font-size: 10px;
  color: #9aa5ae;
}
</style>
