<script setup lang="ts">
import { ref, onMounted } from 'vue'
import ExperimentStage from '../components/ExperimentStage.vue'

const expId = ref('w1.demo')
const title = ref('实验台')

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
  }
  // 通知原生壳：引擎就绪
  postToNative('engine.ready', { three: 'v2' })
})

function onBack(): void {
  postToNative('nav.back', {})
}
</script>

<template>
  <ExperimentStage :experiment-id="expId" :title="title" @back="onBack" />
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
