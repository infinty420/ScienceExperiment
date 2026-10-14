<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

/**
 * 3D 实验台（PC 版 W1）。
 * PC 上 UI 与引擎同在浏览器运行时，桥退化为同层调用：
 *   UI -> 引擎 : window.__engine.onMessage(json)
 *   引擎 -> UI : window.nativeBridge.onMessage(json)（本组件注册的 shim）
 */

const props = defineProps<{ experimentId: string; title: string }>()
const emit = defineEmits<{ (e: 'back'): void }>()

const fps = ref(0)
const status = ref('引擎加载中…')
const spinning = ref(true)
const wireframe = ref(false)
const spinSpeed = ref(1.0)

let seq = 0
let engine: { onMessage: (s: string) => void } | null = null

function send(type: string, payload: Record<string, unknown>): void {
  if (!engine) return
  seq += 1
  engine.onMessage(JSON.stringify({ msgId: `ui-${seq}`, type, payload }))
}

// 引擎 -> UI 消息分发（必须在引擎脚本加载前注册）
;(window as unknown as Record<string, unknown>).nativeBridge = {
  onMessage(msg: string): void {
    const m = JSON.parse(msg) as { type: string; payload: Record<string, unknown> }
    if (m.type === 'engine.ready') {
      status.value = `引擎就绪 (three r${m.payload.three})`
      send('scene.spin', { on: spinning.value })
      send('scene.speed', { value: spinSpeed.value })
    } else if (m.type === 'fps') {
      fps.value = m.payload.fps as number
    } else if (m.type === 'scene.state') {
      spinSpeed.value = m.payload.speed as number
    } else if (m.type === 'error') {
      status.value = `引擎消息错误: ${JSON.stringify(m.payload)}`
    }
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 幂等：已加载过则跳过
    const exist = document.querySelector(`script[data-engine="${src}"]`)
    if (exist) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.async = false
    s.dataset.engine = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`加载失败: ${src}`))
    document.head.appendChild(s)
  })
}

onMounted(async () => {
  try {
    await loadScript('/engine/three.min.js')
    await loadScript('/engine/core.js')
    await loadScript('/engine/main.js')

    const canvas = document.getElementById('stage-canvas') as HTMLCanvasElement | null
    const boot = (window as unknown as Record<string, unknown>).__scilabBootDemo as
      | ((c: HTMLCanvasElement) => void)
      | undefined
    if (canvas && boot) {
      boot(canvas)
      engine = (window as unknown as Record<string, unknown>).__engine as { onMessage: (s: string) => void }
      send('engine.init', { experimentId: props.experimentId })
    } else {
      status.value = '引擎启动失败'
    }
  } catch (e) {
    status.value = `引擎加载失败: ${e}`
  }
})

onUnmounted(() => {
  const w = window as unknown as Record<string, unknown>
  if (w.__engine) {
    ;(w.__engine as { running: boolean }).running = false
  }
  engine = null
})

function toggleSpin(): void {
  spinning.value = !spinning.value
  send('scene.spin', { on: spinning.value })
}

function toggleWireframe(): void {
  wireframe.value = !wireframe.value
  send('scene.wireframe', { on: wireframe.value })
}

function resetScene(): void {
  spinning.value = true
  wireframe.value = false
  spinSpeed.value = 1.0
  send('scene.reset', {})
}

function onSpeed(value: number): void {
  spinSpeed.value = value
  send('scene.speed', { value })
}
</script>

<template>
  <div class="stage">
    <!-- 工具栏 -->
    <div class="toolbar">
      <button class="back" @click="emit('back')">‹ 返回</button>
      <span class="title">{{ title }}</span>
      <span class="fps" :class="{ ok: fps > 0 }">{{ fps > 0 ? `${fps} FPS` : '…' }}</span>
    </div>

    <!-- 3D 画布 -->
    <div class="canvas-wrap">
      <canvas id="stage-canvas"></canvas>
      <div class="hud">SciLab Engine W1 · 拖拽旋转 · 滚轮缩放</div>
    </div>

    <!-- 控制面板 -->
    <div class="panel">
      <span class="status">{{ status }}</span>
      <div class="controls">
        <button class="btn primary" @click="toggleSpin">{{ spinning ? '暂停' : '继续' }}</button>
        <button class="btn" @click="resetScene">重置</button>
        <button class="btn warn" @click="toggleWireframe">{{ wireframe ? '实体' : '线框' }}</button>
        <label class="speed">
          转速
          <input type="range" min="0" max="3" step="0.1" :value="spinSpeed" @input="onSpeed(Number(($event.target as HTMLInputElement).value))" />
          <span>{{ spinSpeed.toFixed(1) }}</span>
        </label>
      </div>
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

.back:hover {
  color: #222;
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

.canvas-wrap {
  flex: 1;
  position: relative;
  background: #1a2430;
  min-height: 0;
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

.panel {
  background: #fff;
  border-top: 1px solid #e5e7ea;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.status {
  font-size: 11px;
  color: #999;
  min-width: 180px;
}

.controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn {
  padding: 6px 16px;
  font-size: 13px;
  background: #eef1f4;
  color: #333;
}

.btn.primary {
  background: #3f8f79;
  color: #fff;
}

.btn.warn {
  background: #8a6a4a;
  color: #fff;
}

.speed {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #666;
  margin-left: 20px;
}

.speed input[type='range'] {
  width: 160px;
  accent-color: #3f8f79;
}

.speed span {
  color: #3f8f79;
  font-family: Consolas, monospace;
  width: 28px;
}
</style>
