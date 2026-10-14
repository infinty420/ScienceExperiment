<script setup lang="ts">
import { ref, computed } from 'vue'
import { SUBJECTS, EXPERIMENTS, experimentsOf, difficultyLabel, type ExperimentInfo } from './data/experiments'
import { getHistory, clearHistory, type HistoryEntry } from './store/history'
import ExperimentStage from './components/ExperimentStage.vue'

type View = 'list' | 'stage'

const EXPERIMENTS_DEMO: ExperimentInfo = EXPERIMENTS.find((e) => e.id === 'w1.demo')!

const view = ref<View>('list')
const history = ref<HistoryEntry[]>(getHistory())
const searchKey = ref('')

const searchResults = computed(() => {
  const k = searchKey.value.trim().toLowerCase()
  if (!k) return []
  return EXPERIMENTS.filter(
    (e) => e.available && e.id !== 'w1.demo' && (e.title.toLowerCase().includes(k) || e.subjectLabel.includes(k))
  )
})

const totalAvailable = computed(() => EXPERIMENTS.filter((e) => e.available && e.id !== 'w1.demo').length)
const progressPct = computed(() => Math.round((history.value.length / totalAvailable.value) * 100))
const subjectKey = ref('physics')
const current = ref<ExperimentInfo | null>(null)

const subjectInfo = computed(() => SUBJECTS.find((s) => s.key === subjectKey.value) ?? SUBJECTS[0])
const list = computed(() => experimentsOf(subjectKey.value))

function selectSubject(key: string): void {
  subjectKey.value = key
  view.value = 'list'
}

function openExperiment(e: ExperimentInfo): void {
  if (!e.available) return
  current.value = e
  view.value = 'stage'
}

function backToList(): void {
  view.value = 'list'
  current.value = null
  history.value = getHistory()
}

function onClearHistory(): void {
  clearHistory()
  history.value = []
}
</script>

<template>
  <div class="layout">
    <!-- 侧边栏 -->
    <aside class="sidebar">
      <div class="logo">
        <div class="logo-mark">S</div>
        <div>
          <div class="logo-title">智实验</div>
          <div class="logo-sub">SciLab 3D</div>
        </div>
      </div>

      <nav class="nav">
        <div class="search-box">
          <input v-model="searchKey" placeholder="搜索实验…" />
        </div>
        <div
          v-for="s in SUBJECTS"
          :key="s.key"
          class="nav-item"
          :class="{ active: view === 'list' && subjectKey === s.key }"
          @click="selectSubject(s.key)"
        >
          <span class="nav-icon">{{ s.icon }}</span>
          <span>{{ s.label }}</span>
        </div>
        <div class="nav-item" :class="{ active: view === 'stage' && current?.id === 'w1.demo' }" @click="openExperiment(EXPERIMENTS_DEMO)">
          <span class="nav-icon">▶</span>
          <span>W1 渲染验证</span>
        </div>
        <div
          class="nav-item"
          :class="{ active: view === 'list' && subjectKey === '__history' }"
          @click="subjectKey = '__history'; view = 'list'"
        >
          <span class="nav-icon">✓</span>
          <span>我的成绩</span>
        </div>
      </nav>

      <div class="sidebar-footer">v0.7 · 21 个实验 · 全程离线</div>
    </aside>

    <!-- 主区域 -->
    <main class="main">
      <template v-if="searchKey.trim()">
        <header class="list-header">
          <h1>搜索结果</h1>
          <span class="list-count">「{{ searchKey }}」匹配 {{ searchResults.length }} 个实验</span>
        </header>
        <div class="list-grid">
          <div
            v-for="e in searchResults"
            :key="e.id"
            class="exp-card"
            @click="openExperiment(e)"
          >
            <div class="exp-title">{{ e.title }}</div>
            <div class="exp-meta">
              <span>{{ e.subjectLabel }}</span><span>·</span>
              <span>难度 {{ difficultyLabel(e.difficulty) }}</span>
            </div>
            <div class="exp-action go">开始实验</div>
          </div>
          <div v-if="searchResults.length === 0" class="empty-history">没有匹配的实验，换个关键词试试</div>
        </div>
      </template>

      <template v-else-if="view === 'list' && subjectKey !== '__history'">
        <header class="list-header">
          <h1>{{ subjectInfo.label }}实验室</h1>
          <span class="list-count">{{ list.length }} 个实验</span>
        </header>
        <div class="progress-strip">
          <span class="progress-label">学习进度：已完成 {{ history.length }} / {{ totalAvailable }} 个实验</span>
          <div class="progress-bar"><div class="progress-fill" :style="{ width: progressPct + '%' }"></div></div>
          <span class="progress-pct">{{ progressPct }}%</span>
        </div>

        <div class="list-grid">
          <div
            v-for="e in list"
            :key="e.id"
            class="exp-card"
            :class="{ disabled: !e.available }"
            @click="openExperiment(e)"
          >
            <div class="exp-title">{{ e.title }}</div>
            <div class="exp-meta">
              <span>难度 {{ difficultyLabel(e.difficulty) }}</span>
              <span>·</span>
              <span>{{ e.wave }} 上线</span>
            </div>
            <div class="exp-action" :class="{ go: e.available }">
              {{ e.available ? '开始实验' : '敬请期待' }}
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="view === 'stage' && current">
        <ExperimentStage :experiment-id="current.id" :title="current.title" @back="backToList" />
      </template>

      <template v-else-if="subjectKey === '__history'">
        <header class="list-header">
          <h1>我的成绩</h1>
          <span class="list-count">{{ history.length }} 条完成记录</span>
          <button v-if="history.length" class="clear-btn" @click="onClearHistory">清空</button>
        </header>
        <div class="list-grid">
          <div v-for="h in history" :key="h.experimentId" class="exp-card">
            <div class="exp-title">{{ h.title }}</div>
            <div class="exp-meta"><span>{{ h.date }}</span><span>·</span><span>{{ h.rowCount }} 组数据</span></div>
            <div class="history-result">{{ h.resultLines[0] }}</div>
          </div>
          <div v-if="history.length === 0" class="empty-history">
            还没有完成的实验。进入实验室完成任一实验后，成绩会自动保存在本地。
          </div>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  width: 100%;
  height: 100%;
}

/* 侧边栏 */
.sidebar {
  width: 200px;
  height: 100%;
  background: #1e2a36;
  color: #cfd8e3;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
  border-bottom: 1px solid #2b3a48;
}

.logo-mark {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #3f8f79;
  color: #fff;
  font-size: 20px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-title {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}

.logo-sub {
  font-size: 11px;
  color: #7a8a99;
}

.search-box {
  margin-bottom: 8px;
}

.search-box input {
  width: 100%;
  box-sizing: border-box;
  border: none;
  border-radius: 8px;
  background: #28394a;
  color: #dfe8f0;
  font-size: 13px;
  padding: 8px 12px;
  outline: none;
}

.search-box input::placeholder {
  color: #5f7080;
}

.progress-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 28px 14px;
}

.progress-label {
  font-size: 12px;
  color: #778;
  white-space: nowrap;
}

.progress-bar {
  flex: 1;
  height: 8px;
  background: #e4e8ec;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #3f8f79;
  border-radius: 4px;
  transition: width 0.4s;
}

.progress-pct {
  font-size: 12px;
  color: #3f8f79;
  font-family: Consolas, monospace;
}

.nav {
  flex: 1;
  padding: 12px 10px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  margin-bottom: 4px;
}

.nav-item:hover {
  background: #28394a;
}

.nav-item.active {
  background: #3f8f79;
  color: #fff;
}

.nav-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.sidebar-footer {
  padding: 14px 16px;
  font-size: 11px;
  color: #5a6a79;
  border-top: 1px solid #2b3a48;
}

/* 主区域 */
.main {
  flex: 1;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.list-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 22px 28px 10px;
}

.list-header h1 {
  font-size: 22px;
}

.list-count {
  font-size: 13px;
  color: #999;
}

.list-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
  padding: 12px 28px 28px;
}

.exp-card {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  transition: box-shadow 0.15s;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.exp-card:hover {
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.12);
}

.exp-card.disabled {
  opacity: 0.65;
}

.exp-card.disabled:hover {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

.exp-title {
  font-size: 15px;
  font-weight: 600;
}

.exp-meta {
  font-size: 12px;
  color: #999;
  display: flex;
  gap: 6px;
}

.exp-action {
  font-size: 12px;
  color: #aaa;
  border: 1px solid #ddd;
  border-radius: 12px;
  padding: 3px 10px;
  align-self: flex-start;
}

.exp-action.go {
  color: #fff;
  background: #3f8f79;
  border-color: #3f8f79;
}

.clear-btn {
  margin-left: auto;
  font-size: 12px;
  color: #c05a5a;
  background: none;
  padding: 4px 10px;
}

.history-result {
  font-size: 12px;
  color: #3a8a6a;
  background: #eaf5f0;
  border-radius: 6px;
  padding: 6px 10px;
  font-family: Consolas, monospace;
}

.empty-history {
  grid-column: 1 / -1;
  text-align: center;
  color: #aaa;
  font-size: 13px;
  padding: 60px 0;
}
</style>
