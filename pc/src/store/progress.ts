/**
 * V2 学习进度（T7）：三层闭环记录。
 * 每实验：预习检测正确率 → 实验完成 → 课后检验正确率。
 * 薄弱实验（课后 < 60%）在首页推荐重做。
 *
 * V3.1（方案 §3.2）：内部转发到 learning/db 的 IndexedDB 持久层。
 * 对外保持全部同步 API 与 V2 localStorage 键不变：
 *   1. 同步读写走内存镜像 + localStorage（兼容旧调用、兼容鸿蒙 WebView 降级）
 *   2. 每次写入异步镜像到 labDB 的 settings，按学习者档案隔离
 *   3. 启动时 hydrateProgress() 从持久层恢复，并把 V2 旧数据迁移进去
 * 这样 V2 的 overallProgress / weakExperiments / entryScore 不再是「只存本地」的孤岛。
 */
import { labDB, activeProfileId } from '../learning/db'

export interface ProgressEntry {
  /** 预习检测正确率 0-100（null = 未做） */
  preview: number | null
  /** 实验是否完成 */
  done: boolean
  /** 课后检验正确率 0-100（null = 未做） */
  review: number | null
}

const KEY = 'scilab.progress.v1'
const DB_PREFIX = 'progress.v2.'
const DEFAULT_PROFILE = 'profile.default'
type ProgressMap = Record<string, ProgressEntry>

interface ProgressRecord {
  id: string
  value: ProgressMap
  updatedAt: number
  source: 'progress'
  [key: string]: unknown
}

let mirror: ProgressMap | null = null
let activeProfile = DEFAULT_PROFILE
/** 串行化异步写入，避免快速连续操作互相覆盖 */
let queue: Promise<void> = Promise.resolve()

function isMap(v: unknown): v is ProgressMap {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function readLocal(): ProgressMap {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return isMap(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeLocal(map: ProgressMap): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch { /* 配额不足时保持内存态 */ }
}

function current(): ProgressMap {
  if (!mirror) mirror = readLocal()
  return mirror
}

/** 写入新持久层：失败静默降级，同步路径不受影响 */
function persist(map: ProgressMap): void {
  const snapshot: ProgressMap = JSON.parse(JSON.stringify(map))
  const record: ProgressRecord = {
    id: DB_PREFIX + activeProfile,
    value: snapshot,
    updatedAt: Date.now(),
    source: 'progress'
  }
  queue = queue.then(async () => {
    try {
      await labDB.put('settings', record)
    } catch { /* 持久层不可用时保留 localStorage 兜底 */ }
  })
}

/** 等待所有异步写入落库（页面关闭前 / 测试中调用） */
export async function flushProgress(): Promise<void> {
  await queue
}

export function getProgress(): ProgressMap {
  // 与 V2「每次从 JSON 重新解析」等价：返回深拷贝，调用方改动不会污染内存镜像
  return JSON.parse(JSON.stringify(current())) as ProgressMap
}

export function markQuiz(experimentId: string, phase: 'preview' | 'review', pct: number): void {
  const map = current()
  const e = map[experimentId] ?? { preview: null, done: false, review: null }
  e[phase] = pct
  map[experimentId] = e
  writeLocal(map)
  persist(map)
}

export function markDone(experimentId: string): void {
  const map = current()
  const e = map[experimentId] ?? { preview: null, done: false, review: null }
  e.done = true
  map[experimentId] = e
  writeLocal(map)
  persist(map)
}

/** 单实验得分（预习 25% + 实验 50% + 课后 25%），全空返回 null */
export function entryScore(e: ProgressEntry | undefined): number | null {
  if (!e) return null
  const parts: Array<[number, number]> = [
    [e.preview ?? 0, e.preview === null ? 0 : 25],
    [e.done ? 100 : 0, 50],
    [e.review ?? 0, e.review === null ? 0 : 25]
  ]
  const totalW = 25 + 50 + 25
  const got = parts.reduce((s, [v, w]) => s + (v * w) / 100, 0)
  const touched = e.preview !== null || e.done || e.review !== null
  return touched ? Math.round((got / totalW) * 100) : null
}

/** 总学习进度百分比（对可用实验集合） */
export function overallProgress(ids: string[]): number {
  if (ids.length === 0) return 0
  const map = getProgress()
  let sum = 0
  for (const id of ids) sum += entryScore(map[id]) ?? 0
  return Math.round(sum / ids.length)
}

/** 薄弱实验（做过课后检验且 < 60%） */
export function weakExperiments(): Array<{ id: string; review: number }> {
  const map = getProgress()
  const out: Array<{ id: string; review: number }> = []
  for (const [id, e] of Object.entries(map)) {
    if (e.review !== null && e.review < 60) out.push({ id, review: e.review })
  }
  return out.sort((a, b) => a.review - b.review)
}

/**
 * 应用启动时调用（App.vue onMounted）：恢复当前档案的进度。
 * 若持久层尚无记录而 V2 localStorage 有数据，则自动迁移一次。
 */
export async function hydrateProgress(profileId?: string): Promise<{ restored: boolean; profile: string; migrated: boolean }> {
  activeProfile = profileId ?? await activeProfileId()
  const id = DB_PREFIX + activeProfile
  let own: ProgressMap | undefined
  let hasAnyProgress = false
  try {
    const rec = await labDB.get<ProgressRecord>('settings', id)
    own = isMap(rec?.value) ? rec?.value : undefined
    const all = await labDB.getAll<{ id: string; [key: string]: unknown }>('settings')
    hasAnyProgress = all.some((r) => typeof r?.id === 'string' && r.id.startsWith(DB_PREFIX))
  } catch { /* 持久层不可用时走本地数据 */ }

  // 持久层已有本档案记录 → 以 DB 为准（localStorage 只是兼容镜像，不反向污染）；
  // 全系统首次启动（无任何 progress 记录）→ 迁移 V2 localStorage；
  // 已有其他档案但本档案是新档案 → 从空进度开始，绝不继承别人的本地数据。
  let migrated = false
  let merged: ProgressMap
  if (isMap(own)) {
    merged = { ...own }
  } else if (!hasAnyProgress) {
    merged = { ...readLocal() }
    migrated = Object.keys(merged).length > 0
  } else {
    merged = {}
  }

  mirror = merged
  writeLocal(merged)
  if (!isMap(own) && Object.keys(merged).length) persist(merged)
  return { restored: isMap(own), profile: activeProfile, migrated }
}

/** 切换学习者档案后重新 hydrate，保证进度按档案隔离 */
export async function switchProgressProfile(id: string): Promise<void> {
  mirror = null
  await hydrateProgress(id)
}

/** 诊断用：确认同步桥已接通 */
export function progressBridgeStatus(): { profile: string; hydrated: boolean; entries: number } {
  return { profile: activeProfile, hydrated: mirror !== null, entries: Object.keys(current()).length }
}
