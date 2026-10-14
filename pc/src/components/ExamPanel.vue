<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import type { ExamDef } from '../experiments/types'

/**
 * V2 考核面板（T4）
 * 倒计时 + 交卷 + 评分结果展示。评分计算由实验台完成并回传。
 */
const props = defineProps<{
  exam: ExamDef
  title: string
  /** 评分结果（交卷后由实验台回填） */
  scoreDetail: {
    total: number
    items: Array<{ name: string; earned: number; full: number; note: string }>
  } | null
}>()

const emit = defineEmits<{
  (e: 'start'): void
  (e: 'submit'): void
  (e: 'close'): void
}>()

const phase = ref<'ready' | 'running' | 'done'>('ready')
const remainSec = ref(props.exam.timeLimitSec)
let timer: ReturnType<typeof setInterval> | null = null

const remainText = computed(() => {
  const m = Math.floor(remainSec.value / 60)
  const s = remainSec.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

function begin(): void {
  phase.value = 'running'
  emit('start')
  timer = setInterval(() => {
    remainSec.value--
    if (remainSec.value <= 0) {
      stopTimer()
      emit('submit')
      phase.value = 'done'
    }
  }, 1000)
}

function submit(): void {
  if (phase.value !== 'running') return
  stopTimer()
  emit('submit')
  phase.value = 'done'
}

function stopTimer(): void {
  if (timer) clearInterval(timer)
  timer = null
}

watch(
  () => props.scoreDetail,
  (d) => {
    if (d) phase.value = 'done'
  }
)

onUnmounted(stopTimer)
</script>

<template>
  <div class="exam-panel">
    <div class="exam-head">
      <span>📝 考核模式</span>
      <span class="exam-timer" v-if="phase === 'running'" :class="{ urgent: remainSec < 60 }">{{ remainText }}</span>
      <button class="exam-close" @click="emit('close')">✕</button>
    </div>

    <div class="exam-body">
      <!-- 待开始 -->
      <template v-if="phase === 'ready' && !scoreDetail">
        <div class="exam-brief">
          <p><b>{{ title }}</b> 限时考核</p>
          <p class="muted">限时 {{ Math.ceil(exam.timeLimitSec / 60) }} 分钟 · 按时交卷</p>
          <ul class="exam-goals">
            <li v-for="(g, i) in exam.goals" :key="i">
              {{ g.minRecords ? `至少记录 ${g.minRecords} 组数据（${g.weight} 分）` : `测量「${g.metric}」目标 ${g.expect}（误差 ≤ ${g.tolerance}，${g.weight} 分）` }}
            </li>
            <li>规范操作步骤（步骤分自动评定）</li>
          </ul>
          <button class="btn primary" @click="begin">开始考核</button>
        </div>
      </template>

      <!-- 进行中 -->
      <template v-else-if="phase === 'running'">
        <ul class="checklist">
          <li v-for="(c, i) in exam.checklist" :key="i">{{ c }}</li>
        </ul>
        <button class="btn danger" @click="submit">交卷</button>
      </template>

      <!-- 成绩 -->
      <template v-else-if="scoreDetail">
        <div class="score-big">{{ scoreDetail.total }}<span class="score-full"> / 100</span></div>
        <div class="score-items">
          <div v-for="(it, i) in scoreDetail.items" :key="i" class="score-item">
            <span class="si-name">{{ it.name }}</span>
            <span class="si-note">{{ it.note }}</span>
            <span class="si-earned" :class="{ full: it.earned >= it.full }">{{ it.earned }} / {{ it.full }}</span>
          </div>
        </div>
        <button class="btn" @click="emit('close')">完成</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.exam-panel {
  position: absolute;
  left: 12px;
  top: 40px;
  width: 300px;
  background: #fff;
  border: 1px solid #e2e6ea;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
  z-index: 15;
  overflow: hidden;
}

.exam-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #8a5fb8;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}

.exam-timer {
  margin-left: auto;
  font-family: Consolas, monospace;
  font-size: 15px;
}

.exam-timer.urgent {
  color: #ffd2d2;
  animation: blink 1s infinite;
}

@keyframes blink {
  50% { opacity: 0.55; }
}

.exam-close {
  background: none;
  color: #fff;
  font-size: 13px;
}

.exam-body {
  padding: 12px;
  font-size: 13px;
}

.exam-brief p {
  margin: 4px 0;
}

.muted {
  color: #99a;
  font-size: 12px;
}

.exam-goals {
  margin: 8px 0;
  padding-left: 18px;
  color: #556;
  font-size: 12px;
  line-height: 1.9;
}

.btn {
  width: 100%;
  padding: 8px 0;
  font-size: 13px;
  border: 1px solid #d8dde2;
  border-radius: 8px;
  background: #eef1f4;
  color: #333;
  cursor: pointer;
  margin-top: 8px;
}

.btn.primary {
  background: #8a5fb8;
  border-color: #8a5fb8;
  color: #fff;
}

.btn.danger {
  background: #c04545;
  border-color: #c04545;
  color: #fff;
}

.checklist {
  padding-left: 18px;
  color: #556;
  font-size: 12px;
  line-height: 2;
}

.score-big {
  text-align: center;
  font-size: 42px;
  font-weight: 700;
  color: #3f8f79;
  font-family: Consolas, monospace;
}

.score-full {
  font-size: 16px;
  color: #99a;
}

.score-items {
  margin: 10px 0;
  border-top: 1px solid #f0f2f4;
}

.score-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 0;
  border-bottom: 1px solid #f0f2f4;
  font-size: 12px;
}

.si-name {
  font-weight: 600;
  color: #445;
  white-space: nowrap;
}

.si-note {
  color: #99a;
  font-size: 11px;
  flex: 1;
}

.si-earned {
  font-family: Consolas, monospace;
  color: #b07a2e;
}

.si-earned.full {
  color: #3f8f79;
}
</style>
