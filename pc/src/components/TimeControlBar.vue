<script setup lang="ts">
/**
 * V2 时间控制中心（T1）
 * 慢动作 0.1×–10× + 暂停/单步 + 录制/回放状态展示。
 * 模型：timeScale(number) / paused(boolean) 双向绑定。
 */
const props = defineProps<{
  timeScale: number
  paused: boolean
  recording: boolean
  replaying: boolean
}>()

const emit = defineEmits<{
  (e: 'update:timeScale', v: number): void
  (e: 'update:paused', v: boolean): void
  (e: 'step'): void
  (e: 'toggle-record'): void
}>()

const PRESETS = [0.1, 0.25, 0.5, 1, 2, 5, 10]

function preset(v: number): void {
  emit('update:timeScale', v)
}

function togglePause(): void {
  emit('update:paused', !props.paused)
}
</script>

<template>
  <div class="time-bar">
    <button class="tc-btn" :class="{ on: paused }" @click="togglePause" :title="paused ? '继续' : '暂停'">
      {{ paused ? '▶' : '⏸' }}
    </button>
    <button class="tc-btn" :disabled="!paused" @click="emit('step')" title="单步 1/120s">⏭</button>

    <div class="presets">
      <button
        v-for="p in PRESETS"
        :key="p"
        class="tc-preset"
        :class="{ on: Math.abs(timeScale - p) < 1e-9 }"
        @click="preset(p)"
      >
        {{ p }}×
      </button>
    </div>

    <input
      class="tc-slider"
      type="range"
      min="-1"
      max="1.04"
      step="0.01"
      :value="Math.log10(timeScale)"
      @input="emit('update:timeScale', Number(Math.pow(10, Number(($event.target as HTMLInputElement).value)).toFixed(3)))"
    />
    <span class="tc-scale">{{ timeScale < 1 ? timeScale.toFixed(2) : timeScale.toFixed(1) }}×</span>

    <button
      class="tc-btn rec"
      :class="{ on: recording }"
      :disabled="replaying"
      @click="emit('toggle-record')"
      :title="recording ? '停止录制' : '开始录制'"
    >
      {{ recording ? '■' : '●' }}
    </button>
    <span v-if="replaying" class="replaying-tag">回放中</span>
  </div>
</template>

<style scoped>
.time-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #f4f6f8;
  border-bottom: 1px solid #e5e7ea;
  flex-wrap: wrap;
}

.tc-btn {
  width: 30px;
  height: 26px;
  border: 1px solid #d8dde2;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  color: #445;
  line-height: 1;
}

.tc-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.tc-btn.on {
  background: #3f8f79;
  border-color: #3f8f79;
  color: #fff;
}

.tc-btn.rec.on {
  background: #c04545;
  border-color: #c04545;
}

.presets {
  display: flex;
  gap: 4px;
  margin-left: 6px;
}

.tc-preset {
  font-size: 11px;
  font-family: Consolas, monospace;
  padding: 3px 7px;
  border: 1px solid #d8dde2;
  border-radius: 4px;
  background: #fff;
  color: #556;
  cursor: pointer;
}

.tc-preset.on {
  background: #eaf5f0;
  border-color: #3f8f79;
  color: #2c6e5c;
  font-weight: 600;
}

.tc-slider {
  width: 110px;
  accent-color: #3f8f79;
}

.tc-scale {
  font-size: 12px;
  font-family: Consolas, monospace;
  color: #3f8f79;
  min-width: 44px;
}

.replaying-tag {
  font-size: 11px;
  color: #b07a2e;
  background: #f7efdd;
  border-radius: 4px;
  padding: 2px 8px;
}
</style>
