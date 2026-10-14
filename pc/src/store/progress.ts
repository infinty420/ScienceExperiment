/**
 * V2 学习进度（T7）：三层闭环记录。
 * 每实验：预习检测正确率 → 实验完成 → 课后检验正确率。
 * 薄弱实验（课后 < 60%）在首页推荐重做。
 */
export interface ProgressEntry {
  /** 预习检测正确率 0-100（null = 未做） */
  preview: number | null
  /** 实验是否完成 */
  done: boolean
  /** 课后检验正确率 0-100（null = 未做） */
  review: number | null
}

const KEY = 'scilab.progress.v1'
type ProgressMap = Record<string, ProgressEntry>

export function getProgress(): ProgressMap {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as ProgressMap) : {}
  } catch {
    return {}
  }
}

function save(map: ProgressMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export function markQuiz(experimentId: string, phase: 'preview' | 'review', pct: number): void {
  const map = getProgress()
  const e = map[experimentId] ?? { preview: null, done: false, review: null }
  e[phase] = pct
  map[experimentId] = e
  save(map)
}

export function markDone(experimentId: string): void {
  const map = getProgress()
  const e = map[experimentId] ?? { preview: null, done: false, review: null }
  e.done = true
  map[experimentId] = e
  save(map)
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
