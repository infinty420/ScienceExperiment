<script setup lang="ts">
import { ref, computed } from 'vue'
import type { QuizQuestion } from '../experiments/types'

/**
 * V2 题库面板（T7）：预习检测 / 课后检验。
 * 答完 emit('done', {correct, total}) 由上层记入学习进度。
 */
const props = defineProps<{
  title: string
  phase: 'preview' | 'review'
  questions: QuizQuestion[]
}>()

const emit = defineEmits<{
  (e: 'done', r: { correct: number; total: number }): void
  (e: 'close'): void
}>()

const idx = ref(0)
const picked = ref<number | null>(null)
const answers = ref<number[]>([])
const finished = ref(false)

const q = computed(() => props.questions[idx.value])
const correctCount = computed(() => answers.value.filter((a, i) => a === props.questions[i].answer).length)

function pick(i: number): void {
  if (picked.value !== null) return
  picked.value = i
  answers.value[idx.value] = i
}

function next(): void {
  if (idx.value < props.questions.length - 1) {
    idx.value++
    picked.value = answers.value[idx.value] ?? null
  } else {
    finished.value = true
    emit('done', { correct: correctCount.value, total: props.questions.length })
  }
}
</script>

<template>
  <div class="quiz-panel">
    <div class="quiz-head">
      <span>{{ phase === 'preview' ? '📖 预习检测' : '✅ 课后检验' }} · {{ title }}</span>
      <button class="quiz-close" @click="emit('close')">✕</button>
    </div>

    <div class="quiz-body">
      <template v-if="!finished">
        <div class="quiz-progress">{{ idx + 1 }} / {{ questions.length }}</div>
        <div class="quiz-q">{{ q.q }}</div>
        <div class="quiz-options">
          <div
            v-for="(opt, i) in q.options"
            :key="i"
            class="quiz-opt"
            :class="{
              picked: picked === i,
              right: picked !== null && i === q.answer,
              wrong: picked === i && i !== q.answer
            }"
            @click="pick(i)"
          >
            <span class="opt-tag">{{ 'ABCD'[i] }}</span>{{ opt }}
          </div>
        </div>
        <div class="quiz-explain" v-if="picked !== null">
          <template v-if="picked === q.answer">✓ 正确！</template>
          <template v-else>✗ 正确答案 {{ 'ABCD'[q.answer] }}</template>
          {{ q.explain }}
        </div>
        <button class="btn primary" :disabled="picked === null" @click="next">
          {{ idx === questions.length - 1 ? '完成' : '下一题' }}
        </button>
      </template>

      <template v-else>
        <div class="quiz-score">
          {{ correctCount }} / {{ questions.length }}
        </div>
        <div class="quiz-verdict">
          {{ correctCount === questions.length ? '全对，掌握扎实！' : correctCount >= questions.length * 0.6 ? '不错，可回顾错题解析。' : '建议复习实验原理后重做。' }}
        </div>
        <button class="btn" @click="emit('close')">关闭</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.quiz-panel {
  position: absolute;
  left: 12px;
  top: 40px;
  width: 320px;
  background: #fff;
  border: 1px solid #e2e6ea;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
  z-index: 15;
  overflow: hidden;
}

.quiz-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #3e6fb0;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}

.quiz-close {
  background: none;
  color: #fff;
}

.quiz-body {
  padding: 12px;
}

.quiz-progress {
  font-size: 11px;
  color: #99a;
  margin-bottom: 6px;
}

.quiz-q {
  font-size: 13px;
  font-weight: 600;
  color: #22303c;
  line-height: 1.6;
  margin-bottom: 10px;
}

.quiz-opt {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: #445;
  border: 1px solid #e2e6ea;
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  cursor: pointer;
}

.quiz-opt:hover {
  border-color: #3e6fb0;
}

.quiz-opt.right {
  border-color: #3f8f79;
  background: #eaf5f0;
}

.quiz-opt.wrong {
  border-color: #c04545;
  background: #faecec;
}

.opt-tag {
  font-weight: 700;
  color: #889;
  font-size: 11px;
}

.quiz-explain {
  font-size: 12px;
  color: #556;
  background: #f6f8fa;
  border-radius: 8px;
  padding: 8px 10px;
  margin: 8px 0;
  line-height: 1.6;
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
}

.btn.primary {
  background: #3e6fb0;
  border-color: #3e6fb0;
  color: #fff;
}

.btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.quiz-score {
  text-align: center;
  font-size: 36px;
  font-weight: 700;
  color: #3e6fb0;
  font-family: Consolas, monospace;
}

.quiz-verdict {
  text-align: center;
  font-size: 13px;
  color: #556;
  margin: 8px 0 12px;
}
</style>
