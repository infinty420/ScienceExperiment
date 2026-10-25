<script setup lang="ts">
import { ref, onMounted } from 'vue'
import ExperimentStage from '../components/ExperimentStage.vue'

const expId = ref('w1.demo')
const title = ref('实验台')
// r7：boot 前不挂载实验台——初始 key('w1.demo') 与 boot 后真实 id 不同会触发 :key 重建，
// 若首挂即渲染 ExperimentStage 必产生双引擎（旧 dispose 失效成僵尸循环，双 WebGL context → 闪屏）
const booted = ref(false)

function postToNative(type: string, payload: Record<string, unknown>): void {
  const w = window as unknown as { nativeBridge?: { onMessage: (m: string) => void } }
  if (w.nativeBridge) {
    w.nativeBridge.onMessage(JSON.stringify({ msgId: `hos-${Date.now()}`, type, payload }))
  }
}

onMounted(() => {
  const w = window as unknown as { __hosBoot?: (id: string, title: string) => void }
  w.__hosBoot = (id: string, t: string) => {
    expId.value = id
    title.value = t
    booted.value = true
  }
  // 通知原生壳：引擎就绪
  postToNative('engine.ready', { three: 'v2' })
})

function onBack(): void {
  postToNative('nav.back', {})
}
</script>

<template>
  <!-- v-if=booted：boot 前不渲染，杜绝初始引擎；key=expId：实验切换时强制重建（ExperimentStage 仅在挂载时读取 experimentId） -->
  <ExperimentStage v-if="booted" :key="expId" :experiment-id="expId" :title="title" @back="onBack" />
</template>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
* {
  -webkit-tap-highlight-color: transparent;
}
</style>
