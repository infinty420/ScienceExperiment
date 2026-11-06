/**
 * 学习路径推荐器：掌握度 × 遗忘曲线 × 薄弱实验 × 错题密度
 * 接通 V2 遗留的 progress.weakExperiments / overallProgress 死代码。
 */
import { entryScore, type ProgressEntry } from '../store/progress'
import { dueKnowledge, masteryPercent, reviewPriority, type MasteryRecord } from './mastery'
import { dueMistakes, type MistakeCard } from './mistakes'

export type RecommendKind = 'review' | 'weak' | 'new'
export interface Recommendation {
  experimentId: string
  kind: RecommendKind
  score: number
  reason: string
  knowledge?: string
}

export interface RecommendInput {
  experimentIds: string[]
  progress: Record<string, ProgressEntry>
  mastery: MasteryRecord[]
  mistakes: MistakeCard[]
  now?: number
  limit?: number
}

export function knowledgeKey(experimentId: string): string {
  return `exp:${experimentId}`
}

export function overallProgressFrom(map: Record<string, ProgressEntry>, ids: string[]): number {
  if (!ids.length) return 0
  return Math.round(ids.reduce((s, id) => s + (entryScore(map[id]) ?? 0), 0) / ids.length)
}

/** 生成排序后的下一步学习建议 */
export function recommendNext(input: RecommendInput): Recommendation[] {
  const now = input.now ?? Date.now()
  const out: Recommendation[] = []
  const dueSet = new Set(dueKnowledge(input.mastery, now).map((m) => m.knowledgeKey))
  const dueCards = dueMistakes(input.mistakes, now)
  const mistakeCount: Record<string, number> = {}
  for (const c of dueCards) mistakeCount[c.experimentId] = (mistakeCount[c.experimentId] ?? 0) + 1

  for (const id of input.experimentIds) {
    const key = knowledgeKey(id)
    const rec = input.mastery.find((m) => m.knowledgeKey === key)
    const p = input.progress[id]
    const score = entryScore(p)
    const mistakes = mistakeCount[id] ?? 0

    if (dueSet.has(key) && rec) {
      out.push({
        experimentId: id,
        kind: 'review',
        score: 100 + reviewPriority(rec, now) * 50 + mistakes * 8,
        reason: `记忆保持率已降至 ${Math.round(retrievabilityPercent(rec, now))}%，建议今天复习${mistakes ? `（另有 ${mistakes} 道待复习错题）` : ''}`,
        knowledge: key
      })
    } else if (p && p.review !== null && p.review < 60) {
      out.push({
        experimentId: id,
        kind: 'weak',
        score: 70 + (60 - p.review) + mistakes * 8,
        reason: `课后检验仅 ${p.review} 分，属于薄弱实验，建议重做后再测`,
        knowledge: key
      })
    } else if (!p?.done) {
      out.push({
        experimentId: id,
        kind: 'new',
        score: 30 + (rec ? (100 - masteryPercent(rec, now)) / 10 : 5),
        reason: score === null ? '尚未开始，按知识依赖顺序推荐为新实验' : '尚未完成实验环节，建议继续完成',
        knowledge: key
      })
    } else if (mistakes > 0) {
      out.push({
        experimentId: id,
        kind: 'review',
        score: 45 + mistakes * 10,
        reason: `有 ${mistakes} 道错题到达复习时间`,
        knowledge: key
      })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, input.limit ?? 6)
}

function retrievabilityPercent(rec: MasteryRecord, now: number): number {
  const r = 1 / (1 + Math.max(0, now - rec.memory.lastReview) / (9 * Math.max(1, rec.memory.stability)))
  return Math.round(r * 100)
}

export interface StudyPlan {
  generatedAt: number
  overallProgress: number
  dueCount: number
  masteredCount: number
  items: Recommendation[]
}

export function buildStudyPlan(input: RecommendInput): StudyPlan {
  const now = input.now ?? Date.now()
  return {
    generatedAt: now,
    overallProgress: overallProgressFrom(input.progress, input.experimentIds),
    dueCount: dueKnowledge(input.mastery, now).length + dueMistakes(input.mistakes, now).length,
    masteredCount: input.mastery.filter((m) => m.pKnown >= 0.85).length,
    items: recommendNext(input)
  }
}
