<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { SUBJECTS, EXPERIMENTS, experimentsOf, difficultyLabel, type ExperimentInfo } from './data/experiments'
import { getHistory, clearHistory, type HistoryEntry } from './store/history'
import { getFavorites, toggleFavorite, getRecent, pushRecent } from './store/favorites'
import ExperimentStage from './components/ExperimentStage.vue'
import CompareChart, { type CompareSet } from './components/CompareChart.vue'
import StatsDashboard from './components/StatsDashboard.vue'

type View = 'list' | 'stage' | 'compare'

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
  pushRecent(e.id)
  recentIds.value = getRecent()
  current.value = e
  view.value = 'stage'
}

/* ───── V3：收藏 + 最近使用 ───── */
const favIds = ref<string[]>(getFavorites())
const recentIds = ref<string[]>(getRecent())
const historyTab = ref<'records' | 'stats'>('records')

function isFav(id: string): boolean {
  return favIds.value.includes(id)
}

function onToggleFav(e: ExperimentInfo): void {
  const now = toggleFavorite(e.id)
  favIds.value = getFavorites()
  if (now) pushRecent(e.id)
  recentIds.value = getRecent()
}

const recentExps = computed(() =>
  recentIds.value
    .map((id) => EXPERIMENTS.find((e) => e.id === id))
    .filter((e): e is ExperimentInfo => !!e && e.available)
    .slice(0, 4)
)

function backToList(): void {
  view.value = 'list'
  current.value = null
  history.value = getHistory()
}

function onClearHistory(): void {
  clearHistory()
  history.value = []
}

/* ───── V2：对照实验模式（T3） ───── */
const availableExps = computed(() => EXPERIMENTS.filter((e) => e.available))
const compareAId = ref('physics.inclined_plane')
const compareBId = ref('physics.free_fall')
const stageARef = ref<InstanceType<typeof ExperimentStage> | null>(null)
const stageBRef = ref<InstanceType<typeof ExperimentStage> | null>(null)
const setA = ref<CompareSet | null>(null)
const setB = ref<CompareSet | null>(null)

const compareAInfo = computed(() => availableExps.value.find((e) => e.id === compareAId.value))
const compareBInfo = computed(() => availableExps.value.find((e) => e.id === compareBId.value))

let compareTimer: ReturnType<typeof setInterval> | null = null
function refreshCompare(): void {
  const a = stageARef.value?.getSnapshot()
  const b = stageBRef.value?.getSnapshot()
  if (a && a.rows.length > 0) setA.value = a as CompareSet
  if (b && b.rows.length > 0) setB.value = b as CompareSet
}

function openCompare(): void {
  view.value = 'compare'
  setA.value = null
  setB.value = null
  compareTimer = setInterval(refreshCompare, 800)
}

function closeCompare(): void {
  if (compareTimer) clearInterval(compareTimer)
  compareTimer = null
  view.value = 'list'
}

onUnmounted(() => {
  if (compareTimer) clearInterval(compareTimer)
})
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
        <template v-if="recentExps.length && !searchKey.trim()">
          <div class="nav-group-title">最近使用</div>
          <div
            v-for="e in recentExps"
            :key="'r-' + e.id"
            class="nav-item recent"
            :class="{ active: view === 'stage' && current?.id === e.id }"
            @click="openExperiment(e)"
          >
            <span class="nav-icon">·</span>
            <span class="recent-title">{{ e.title }}</span>
          </div>
          <div class="nav-divider"></div>
        </template>
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
        <div class="nav-item" :class="{ active: view === 'compare' }" @click="openCompare">
          <span class="nav-icon">⇄</span>
          <span>对照实验</span>
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

      <div class="sidebar-footer">v3.0 · 27 个实验 · 全程离线</div>
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
            <span
              class="fav-star"
              :class="{ on: isFav(e.id) }"
              title="收藏"
              @click.stop="onToggleFav(e)"
            >{{ isFav(e.id) ? '★' : '☆' }}</span>
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

      <template v-else-if="view === 'compare'">
        <div class="compare-view">
          <header class="compare-head">
            <button class="compare-back" @click="closeCompare">‹ 返回</button>
            <h1>对照实验 A / B</h1>
            <span class="list-count">左右独立调参，曲线同图对比</span>
          </header>
          <div class="compare-body">
            <div class="compare-slot">
              <div class="compare-select">
                <span class="slot-tag a">A</span>
                <select v-model="compareAId">
                  <option v-for="e in availableExps" :key="e.id" :value="e.id">{{ e.title }}</option>
                </select>
              </div>
              <ExperimentStage
                v-if="compareAInfo"
                ref="stageARef"
                :key="'A' + compareAId"
                :experiment-id="compareAInfo.id"
                :title="compareAInfo.title"
                compact
                @back="() => {}"
              />
            </div>
            <div class="compare-slot">
              <div class="compare-select">
                <span class="slot-tag b">B</span>
                <select v-model="compareBId">
                  <option v-for="e in availableExps" :key="e.id" :value="e.id">{{ e.title }}</option>
                </select>
              </div>
              <ExperimentStage
                v-if="compareBInfo"
                ref="stageBRef"
                :key="'B' + compareBId"
                :experiment-id="compareBInfo.id"
                :title="compareBInfo.title"
                compact
                @back="() => {}"
              />
            </div>
          </div>
          <div class="compare-chart-wrap">
            <div class="compare-chart-title">A / B 数据对比（绿 = A，蓝 = B）</div>
            <CompareChart :set-a="setA" :set-b="setB" />
          </div>
        </div>
      </template>

      <template v-else-if="subjectKey === '__history'">
        <header class="list-header">
          <h1>我的成绩</h1>
          <span class="list-count">{{ history.length }} 条完成记录</span>
          <div class="hist-tabs">
            <button class="hist-tab" :class="{ on: historyTab === 'records' }" @click="historyTab = 'records'">记录列表</button>
            <button class="hist-tab" :class="{ on: historyTab === 'stats' }" @click="historyTab = 'stats'">数据看板</button>
          </div>
          <button v-if="history.length && historyTab === 'records'" class="clear-btn" @click="onClearHistory">清空</button>
        </header>
        <template v-if="historyTab === 'stats'">
          <StatsDashboard :history="history" />
        </template>
        <div v-else class="list-grid">
          <div v-for="h in history" :key="h.experimentId" class="exp-card">
            <div class="exp-title">{{ h.title }}</div>
            <div class="exp-meta">
              <span>{{ h.date }}</span><span>·</span><span>{{ h.rowCount }} 组数据</span>
              <span v-if="h.mode === 'exam'" class="exam-badge">{{ h.score ?? '-' }} 分</span>
            </div>
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
  position: relative;
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

/* V3：最近使用 / 收藏 */
.nav-group-title {
  font-size: 11px;
  color: #5f7080;
  padding: 2px 12px 4px;
}

.nav-divider {
  height: 1px;
  background: #2b3a48;
  margin: 8px 6px;
}

.nav-item.recent {
  padding: 7px 12px;
  font-size: 13px;
}

.recent-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fav-star {
  position: absolute;
  top: 10px;
  right: 12px;
  font-size: 16px;
  color: #c8ccd2;
  cursor: pointer;
  user-select: none;
}

.fav-star:hover {
  color: #e0a93e;
}

.fav-star.on {
  color: #e0a93e;
}

/* V3：成绩视图标签页 */
.hist-tabs {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.hist-tab {
  font-size: 12px;
  color: #778;
  background: none;
  border: 1px solid #dde2e7;
  border-radius: 14px;
  padding: 3px 12px;
  cursor: pointer;
}

.hist-tab.on {
  color: #fff;
  background: #3f8f79;
  border-color: #3f8f79;
}

.exam-badge {
  color: #b3702d;
  font-weight: 600;
  font-family: Consolas, monospace;
}

/* 对照实验 */
.compare-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.compare-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 14px 20px 8px;
}

.compare-head h1 {
  font-size: 18px;
}

.compare-back {
  background: none;
  font-size: 15px;
  color: #666;
  padding: 4px 8px;
}

.compare-body {
  flex: 1;
  display: flex;
  gap: 10px;
  padding: 0 12px;
  min-height: 0;
}

.compare-slot {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid #e2e6ea;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.compare-select {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #eef1f4;
  background: #fafbfc;
}

.compare-select select {
  flex: 1;
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid #d8dde2;
  border-radius: 6px;
  background: #fff;
}

.slot-tag {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.slot-tag.a {
  background: #3f8f79;
}

.slot-tag.b {
  background: #3e6fb0;
}

.compare-chart-wrap {
  padding: 8px 16px 14px;
}

.compare-chart-title {
  font-size: 12px;
  color: #778;
  margin-bottom: 6px;
}

.compare-chart-wrap :deep(canvas) {
  width: 100%;
  height: 200px;
  border: 1px solid #e2e6ea;
  border-radius: 8px;
  background: #fff;
}
</style>
