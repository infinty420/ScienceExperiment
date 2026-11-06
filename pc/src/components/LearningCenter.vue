<script setup lang="ts">
/**
 * V3 学习中心：掌握度（BKT + 遗忘曲线）、错题本复习、学习路径推荐、
 * 多档案、可复现快照管理、实验包导入与离线助教。
 */
import { ref, computed, onMounted } from 'vue'
import { EXPERIMENTS } from '../data/experiments'
import { getProgress, overallProgress, weakExperiments } from '../store/progress'
import { labDB, ensureDefaultProfile, activeProfileId, setActiveProfile, type Profile } from '../learning/db'
import { masteryPercent, retrievability, type MasteryRecord } from '../learning/mastery'
import { reviewMistake, dueMistakes, mistakeStats, type MistakeCard } from '../learning/mistakes'
import { buildStudyPlan, type StudyPlan } from '../learning/recommend'
import { verifySnapshot, replaySnapshot, parseSnapshot, type ExperimentSnapshot } from '../learning/snapshot'
import { registerPackage, exportPackage, listPackages, packageStats, unregisterPackage } from '../experiments/packages'
import { formatIssues } from '../experiments/validate'
import { AssistantEngine } from '../assistant/engine'
import { docsFromScenes } from '../assistant/retrieval'
import { allSceneIds, getSceneDef } from '../experiments/loader'
import { downloadFile, toSnapshotJSON } from '../report/export'

const emit = defineEmits<{ (e: 'open-experiment', id: string): void }>()

const engineName = ref('—')
const profiles = ref<Profile[]>([])
const activeId = ref('profile.default')
const newProfileName = ref('')
const mastery = ref<MasteryRecord[]>([])
const cards = ref<MistakeCard[]>([])
const snapshots = ref<ExperimentSnapshot[]>([])
const message = ref('')
const packageText = ref('')
const packageReport = ref('')
const qaQuestion = ref('')
const qaAnswer = ref('')
const qaSources = ref<string[]>([])

const experimentIds = computed(() => EXPERIMENTS.filter((e) => e.available).map((e) => e.id))
const titleOf = (id: string): string => EXPERIMENTS.find((e) => e.id === id)?.title ?? id
const progressMap = computed(() => getProgress())

const plan = computed<StudyPlan>(() => buildStudyPlan({
  experimentIds: experimentIds.value,
  progress: progressMap.value,
  mastery: mastery.value,
  mistakes: cards.value,
  now: Date.now(),
  limit: 6
}))
const dueCards = computed(() => dueMistakes(cards.value, Date.now()))
const cardStats = computed(() => mistakeStats(cards.value, Date.now()))
const weakList = computed(() => weakExperiments())
const pkgStats = computed(() => packageStats())
const imported = computed(() => listPackages('imported'))

let assistant: AssistantEngine | null = null
function getAssistant(): AssistantEngine {
  if (!assistant) {
    const scenes = allSceneIds().map((id) => {
      const d = getSceneDef(id)
      return { id, title: d?.title ?? id, guide: d?.guide ?? '', meta: d?.meta }
    })
    assistant = new AssistantEngine(docsFromScenes(scenes))
  }
  return assistant
}

async function refresh(): Promise<void> {
  engineName.value = await labDB.init()
  await labDB.migrateLegacy()
  await ensureDefaultProfile()
  profiles.value = await labDB.getAll<Profile>('profiles')
  activeId.value = await activeProfileId()
  const attempts = await labDB.getAll<MasteryRecord & { knowledgeKey?: string }>('attempts')
  mastery.value = attempts.filter((r) => r && typeof r.pKnown === 'number' && r.knowledgeKey)
  cards.value = await labDB.getAll<MistakeCard>('cards')
  snapshots.value = (await labDB.getAll<ExperimentSnapshot>('snapshots')).filter((s) => s && s.schema === 'scilab.snapshot.v3')
}

onMounted(refresh)

async function review(card: MistakeCard, correct: boolean): Promise<void> {
  const updated = reviewMistake(card, correct, Date.now())
  await labDB.put('cards', updated)
  cards.value = cards.value.map((c) => (c.id === updated.id ? updated : c))
  message.value = correct ? `「${card.question.slice(0, 16)}…」复习正确，稳定性提升。` : '已记为遗忘，缩短了下次复习间隔。'
}

function openExperiment(id: string): void {
  emit('open-experiment', id)
}

async function addProfile(): Promise<void> {
  const name = newProfileName.value.trim()
  if (!name) return
  const p: Profile = {
    id: `profile.${Date.now()}`,
    name,
    createdAt: Date.now(),
    color: ['#3f8f79', '#4a7dc0', '#b3702d', '#7f5fb8'][profiles.value.length % 4]
  }
  await labDB.put('profiles', p)
  profiles.value = await labDB.getAll<Profile>('profiles')
  newProfileName.value = ''
  message.value = `已创建档案「${name}」`
}

async function switchProfile(id: string): Promise<void> {
  await setActiveProfile(id)
  activeId.value = id
  message.value = `已切换到 ${profiles.value.find((p) => p.id === id)?.name ?? id}`
}

function checkSnapshot(s: ExperimentSnapshot): void {
  const replay = replaySnapshot(s)
  message.value = `快照 ${s.id.slice(0, 22)}… 校验${verifySnapshot(s) ? '通过' : '失败'}；${replay.ok
    ? `复跑 ${replay.compared} 点，最大偏差 ${replay.maxAbsDiff.toExponential(2)}，${replay.matches ? '结果一致 ✓' : '存在差异 ✗'}`
    : replay.reason}`
}

function downloadSnapshot(s: ExperimentSnapshot): void {
  downloadFile(`${s.id}.json`, toSnapshotJSON(s), 'application/json')
  message.value = '快照已下载，可在其他设备导入复跑。'
}

function importSnapshotText(text: string): void {
  const r = parseSnapshot(text)
  if (!r.ok || !r.snapshot) { message.value = `快照导入失败：${r.error}`; return }
  const s = r.snapshot
  snapshots.value = [s, ...snapshots.value.filter((x) => x.id !== s.id)]
  labDB.put('snapshots', s)
  checkSnapshot(s)
}

function importPackage(): void {
  if (!packageText.value.trim()) { packageReport.value = '请粘贴实验包 JSON。'; return }
  const res = registerPackage(packageText.value)
  packageReport.value = `${res.ok ? '✓ 注册成功' : '✗ 已拒绝'}：${res.id || '（无 id）'}\n${formatIssues(res.report, 12) || '无校验问题'}`
  if (res.ok) { packageText.value = ''; message.value = `实验包 ${res.id} 已加入实验列表` }
}

function exportBuiltin(id: string): void {
  const text = exportPackage(id)
  if (text) downloadFile(`experiment-${id}.json`, text, 'application/json')
}

function removeImported(id: string): void {
  unregisterPackage(id)
  packageReport.value = `已移除导入包 ${id}`
}

function ask(): void {
  const a = getAssistant().ask(qaQuestion.value.trim(), {})
  qaAnswer.value = a.text
  qaSources.value = a.sources.map((s) => s.title)
  qaQuestion.value = ''
}

defineExpose({ importSnapshotText, refresh })
</script>

<template>
  <div class="learning">
    <header class="head">
      <div>
        <h1>学习中心 <span class="badge">V3 学习科学</span></h1>
        <p class="sub">BKT 掌握度 · 遗忘曲线排程 · 错题本 · 学习路径推荐 · 可复现快照 · 实验包管理</p>
      </div>
      <button class="btn" @click="refresh">刷新</button>
    </header>

    <div class="stat-row">
      <div class="stat"><span>总体进度</span><b>{{ plan.overallProgress }}%</b><small>{{ experimentIds.length }} 个实验</small></div>
      <div class="stat"><span>已掌握知识点</span><b>{{ plan.masteredCount }}</b><small>BKT ≥ 0.85</small></div>
      <div class="stat"><span>今日待复习</span><b>{{ plan.dueCount }}</b><small>知识点 + 错题</small></div>
      <div class="stat"><span>薄弱实验</span><b>{{ weakList.length }}</b><small>课后 &lt; 60 分</small></div>
      <div class="stat"><span>存储引擎</span><b class="engine">{{ engineName }}</b><small>{{ snapshots.length }} 份快照</small></div>
    </div>

    <div class="grid">
      <section class="panel">
        <h2>今日学习计划</h2>
        <p class="hint">按「遗忘程度 × 未掌握程度 × 错题密度」排序</p>
        <div v-for="r in plan.items" :key="r.experimentId + r.kind" class="plan-item">
          <span class="kind" :class="r.kind">{{ r.kind === 'review' ? '复习' : r.kind === 'weak' ? '薄弱' : '新实验' }}</span>
          <div class="plan-main">
            <div class="plan-title">{{ titleOf(r.experimentId) }}</div>
            <div class="plan-reason">{{ r.reason }}</div>
          </div>
          <button class="btn sm" @click="openExperiment(r.experimentId)">前往 →</button>
        </div>
        <div v-if="!plan.items.length" class="empty">暂无待办，全部实验都已完成且记忆状态良好。</div>

        <h2>知识点掌握度</h2>
        <div v-for="m in mastery" :key="m.id" class="mastery-row">
          <div class="mastery-label">{{ titleOf(m.knowledgeKey.replace('exp:', '')) }}</div>
          <div class="bar"><div :style="{ width: masteryPercent(m, Date.now()) + '%' }"></div></div>
          <span class="pct">{{ masteryPercent(m, Date.now()) }}%</span>
          <span class="r">R {{ Math.round(retrievability(m.memory, Date.now()) * 100) }}%</span>
        </div>
        <div v-if="!mastery.length" class="empty">完成预习/课后检测后，这里会显示每个知识点的掌握概率与记忆保持率。</div>
      </section>

      <section class="panel">
        <h2>错题复习队列 <span class="count">{{ dueCards.length }} / {{ cards.length }}</span></h2>
        <p class="hint">累计正确率 {{ cardStats.accuracy }}% · 已毕业 {{ cardStats.graduated }}</p>
        <div v-for="c in dueCards.slice(0, 4)" :key="c.id" class="card">
          <div class="card-q">{{ c.question }}</div>
          <div class="card-meta">{{ titleOf(c.experimentId) }} · 知识点 {{ c.knowledge }} · 遗忘 {{ c.lapses }} 次</div>
          <div class="card-explain" v-if="c.lapses > 0">提示：{{ c.explain }}</div>
          <div class="card-actions">
            <button class="btn sm" @click="review(c, false)">忘了</button>
            <button class="btn sm primary" @click="review(c, true)">记得</button>
          </div>
        </div>
        <div v-if="!dueCards.length" class="empty">当前没有到期的错题，间隔重复排程会在合适时间提醒你。</div>

        <h2>可复现快照</h2>
        <div v-for="s in snapshots.slice(0, 6)" :key="s.id" class="snap">
          <div><b>{{ s.title }}</b><small> {{ new Date(s.createdAt).toLocaleString('zh-CN') }}</small></div>
          <div class="snap-id">{{ s.rows.length }} 组数据 · {{ s.checksum.slice(0, 12) }}…</div>
          <div class="card-actions">
            <button class="btn sm" @click="checkSnapshot(s)">校验 / 复跑</button>
            <button class="btn sm" @click="downloadSnapshot(s)">下载</button>
          </div>
        </div>
        <div v-if="!snapshots.length" class="empty">在实验台点击「保存快照」，即可在此校验与复跑。</div>
        <textarea v-model="packageText" class="import-area" placeholder="粘贴快照 JSON 或实验包 JSON…"></textarea>
        <div class="card-actions">
          <button class="btn sm" @click="importSnapshotText(packageText)">导入快照</button>
          <button class="btn sm" @click="importPackage">导入实验包</button>
        </div>
        <pre v-if="packageReport" class="report">{{ packageReport }}</pre>
      </section>

      <section class="panel">
        <h2>学习者档案</h2>
        <div class="profiles">
          <button v-for="p in profiles" :key="p.id" class="profile" :class="{ on: p.id === activeId }" @click="switchProfile(p.id)">
            <span class="dot" :style="{ background: p.color }"></span>{{ p.name }}
          </button>
        </div>
        <div class="add-profile">
          <input v-model="newProfileName" placeholder="新档案名称" @keyup.enter="addProfile" />
          <button class="btn sm" @click="addProfile">添加</button>
        </div>

        <h2>实验包管理 <span class="count">{{ pkgStats.total }}</span></h2>
        <p class="hint">内置 {{ pkgStats.builtin }} · 导入 {{ pkgStats.imported }} · 校验错误 {{ pkgStats.errors }} · 提示 {{ pkgStats.warnings }}</p>
        <div v-for="p in imported" :key="p.scene.id" class="pkg">
          <span>{{ p.scene.title }} <small>{{ p.scene.meta?.license ?? 'NOASSERTION' }}</small></span>
          <button class="btn sm" @click="exportBuiltin(p.scene.id)">导出</button>
          <button class="btn sm" @click="removeImported(p.scene.id)">移除</button>
        </div>
        <div class="card-actions"><button class="btn sm" @click="exportBuiltin('physics.pendulum')">导出示例内置包</button></div>

        <h2>离线助教</h2>
        <div class="qa">
          <input v-model="qaQuestion" placeholder="例如：单摆周期 / 不确定度传播" @keyup.enter="ask" />
          <button class="btn sm primary" @click="ask">提问</button>
        </div>
        <div v-if="qaAnswer" class="qa-answer">{{ qaAnswer }}<div v-if="qaSources.length" class="qa-src">参考：{{ qaSources.join('、') }}</div></div>
      </section>
    </div>

    <p class="msg">{{ message }}</p>
  </div>
</template>

<style scoped>
.learning { padding: 28px 32px; height: 100%; overflow: auto; box-sizing: border-box; background: #f6f8fa; }
.head { display: flex; justify-content: space-between; align-items: flex-start; }
.head h1 { margin: 0; font-size: 24px; color: #1f2937; }
.badge { font-size: 11px; background: #e8eefc; color: #3a5fa8; padding: 3px 8px; border-radius: 10px; vertical-align: middle; }
.sub { margin: 6px 0 20px; color: #64748b; font-size: 13px; }
.stat-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 18px; }
.stat { background: #fff; border: 1px solid #e5e9f0; border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; }
.stat span { font-size: 12px; color: #64748b; }
.stat b { font-size: 24px; color: #2c6654; margin: 2px 0; }
.stat b.engine { font-size: 15px; }
.stat small { font-size: 11px; color: #94a3b8; }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start; }
.panel { background: #fff; border: 1px solid #e5e9f0; border-radius: 12px; padding: 16px 18px; }
.panel h2 { font-size: 14px; margin: 16px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #eef2f7; color: #2c6654; }
.panel h2:first-child { margin-top: 0; }
.count { font-size: 11px; background: #f1f5f9; color: #64748b; padding: 2px 7px; border-radius: 9px; }
.hint { font-size: 11px; color: #94a3b8; margin: 0 0 10px; }
.plan-item, .card, .snap, .pkg { display: flex; gap: 8px; align-items: flex-start; border: 1px solid #e8edf3; border-radius: 8px; padding: 9px 10px; margin-bottom: 8px; font-size: 12px; }
.plan-main { flex: 1; min-width: 0; }
.plan-title { font-weight: 600; color: #1f2937; }
.plan-reason { color: #64748b; line-height: 1.5; margin-top: 2px; }
.kind { font-size: 10px; padding: 2px 6px; border-radius: 5px; white-space: nowrap; background: #f1f5f9; color: #475569; }
.kind.review { background: #fdf0e6; color: #b3702d; }
.kind.weak { background: #fde8e8; color: #b23b3b; }
.kind.new { background: #dff3ec; color: #2c6654; }
.btn { border: 1px solid #d9e1ea; background: #fff; color: #334155; border-radius: 7px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
.btn.sm { padding: 4px 8px; font-size: 11px; }
.btn.primary { background: #3f8f79; color: #fff; border-color: #3f8f79; }
.mastery-row { display: grid; grid-template-columns: minmax(90px, 1fr) 90px 38px 48px; gap: 6px; align-items: center; font-size: 11px; margin-bottom: 6px; }
.mastery-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #475569; }
.bar { height: 7px; background: #eef2f7; border-radius: 4px; overflow: hidden; }
.bar div { height: 100%; background: #3f8f79; }
.pct, .r { color: #64748b; text-align: right; }
.card { flex-direction: column; }
.card-q { font-weight: 600; color: #1f2937; }
.card-meta, .snap-id { color: #94a3b8; font-size: 11px; }
.card-explain { color: #b3702d; font-size: 11px; background: #fff8ee; padding: 5px 7px; border-radius: 6px; }
.card-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.snap { flex-direction: column; }
.snap small { color: #94a3b8; font-weight: 400; margin-left: 6px; }
.import-area, .qa input, .add-profile input { width: 100%; box-sizing: border-box; border: 1px solid #d9e1ea; border-radius: 7px; padding: 7px 9px; font-size: 12px; color: #1f2937; background: #fff; }
.import-area { min-height: 62px; margin: 10px 0 8px; font-family: Consolas, monospace; }
.report { white-space: pre-wrap; font-size: 11px; background: #f8fafc; border: 1px solid #e8edf3; border-radius: 7px; padding: 8px; max-height: 140px; overflow: auto; }
.profiles { display: flex; flex-wrap: wrap; gap: 6px; }
.profile { border: 1px solid #d9e1ea; background: #fff; border-radius: 16px; padding: 5px 10px; font-size: 11px; cursor: pointer; color: #475569; }
.profile.on { border-color: #3f8f79; background: #eaf5f0; color: #2c6654; }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; }
.add-profile { display: flex; gap: 6px; margin-top: 8px; }
.pkg { align-items: center; }
.pkg span { flex: 1; }
.pkg small { color: #94a3b8; margin-left: 6px; }
.qa { display: flex; gap: 6px; }
.qa-answer { margin-top: 8px; font-size: 12px; color: #475569; background: #f8fafc; border-radius: 8px; padding: 9px 10px; white-space: pre-wrap; line-height: 1.7; }
.qa-src { margin-top: 6px; font-size: 11px; color: #94a3b8; }
.empty { font-size: 12px; color: #94a3b8; padding: 10px 0; }
.msg { margin-top: 14px; font-size: 12px; color: #2c6654; min-height: 18px; }
@media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } .stat-row { grid-template-columns: repeat(2, 1fr); } }
</style>
