/**
 * 掌握度建模：BKT 贝叶斯知识追踪 + 记忆 D/S/R 三变量排程
 *
 * 参考思路：open-spaced-repetition/fsrs4anki (MIT) 的难度/稳定性/可提取性建模，
 * Human-Centric-Machine-Learning/memorize (MIT) 的复习时刻优化思想，
 * Carden (MIT) 的卡片毕业阈值；Anki (AGPL-3.0) 仅作为「间隔重复」概念背景，未使用其代码。
 * BKT 与 SM-2 均按公开数学定义独立实现。
 */
import type { StoredRecord } from './db'

export const DAY = 24 * 60 * 60 * 1000

export interface BKTParams {
  /** 先验掌握概率 */
  pL0: number
  /** 学习转移概率 */
  pT: number
  /** 猜对概率 */
  pG: number
  /** 失误概率 */
  pS: number
}

export const DEFAULT_BKT: BKTParams = { pL0: 0.25, pT: 0.12, pG: 0.20, pS: 0.10 }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** 一次作答后的后验掌握概率（含「未掌握→已掌握」的学习转移） */
export function bktUpdate(prior: number, correct: boolean, p: BKTParams = DEFAULT_BKT): number {
  const priorC = clamp(prior, 1e-6, 1 - 1e-6)
  const posterior = correct
    ? (priorC * (1 - p.pS)) / (priorC * (1 - p.pS) + (1 - priorC) * p.pG)
    : (priorC * p.pS) / (priorC * p.pS + (1 - priorC) * (1 - p.pG))
  return clamp(posterior + (1 - posterior) * p.pT, 0, 1)
}

export interface MemoryState {
  /** 难度 1(易) ~ 10(难) */
  difficulty: number
  /** 记忆稳定性（毫秒），R 降到 0.9 所需时间量级 */
  stability: number
  repetitions: number
  lapses: number
  lastReview: number
  /** SM-2 简易 ease factor */
  ease: number
}

export function initialMemory(difficulty = 5, now = Date.now()): MemoryState {
  return { difficulty: clamp(difficulty, 1, 10), stability: DAY, repetitions: 0, lapses: 0, lastReview: now, ease: 2.5 }
}

/** 可提取性 R(t) = 1 / (1 + t / (9S))（幂律遗忘曲线，比纯指数更贴近实证） */
export function retrievability(m: MemoryState, now: number): number {
  const elapsed = Math.max(0, now - m.lastReview)
  return 1 / (1 + elapsed / (9 * Math.max(1, m.stability)))
}

/** 给定目标保持率，下一次该复习的时间戳 */
export function nextReviewAt(m: MemoryState, targetR = 0.9): number {
  const r = clamp(targetR, 0.5, 0.99)
  return m.lastReview + 9 * Math.max(1, m.stability) * (1 / r - 1)
}

/**
 * 复习排程：grade 0–5（≥3 为回忆成功）。
 * 成功时按难度与评分放大稳定性；失败时收缩稳定性并提高难度。
 */
export function scheduleReview(m: MemoryState, grade: number, now: number): MemoryState {
  const g = clamp(Math.round(grade), 0, 5)
  const success = g >= 3
  let difficulty = clamp(m.difficulty + (success ? -0.2 * (g - 3) : 0.6), 1, 10)
  let ease = clamp(m.ease + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02)), 1.3, 3.0)
  let stability: number
  let repetitions = m.repetitions
  let lapses = m.lapses
  if (success) {
    const growth = 1.4 + 0.35 * (g - 3) + (10 - difficulty) / 25
    stability = m.stability * growth * (repetitions === 0 ? 1.6 : 1)
    repetitions += 1
  } else {
    stability = Math.max(0.2 * DAY, m.stability * 0.45)
    lapses += 1
    ease = clamp(m.ease - 0.2, 1.3, 3.0)
    difficulty = clamp(m.difficulty + 0.4, 1, 10)
  }
  return { difficulty, ease, stability: Math.min(stability, 365 * DAY), repetitions, lapses, lastReview: now }
}

export interface MasteryRecord extends StoredRecord {
  id: string
  knowledgeKey: string
  /** BKT 掌握概率 */
  pKnown: number
  memory: MemoryState
  attempts: number
  correct: number
  lastSeen: number
}

export function newMastery(knowledgeKey: string, now = Date.now(), difficulty = 5): MasteryRecord {
  return {
    id: `mastery.${knowledgeKey}`,
    knowledgeKey,
    pKnown: DEFAULT_BKT.pL0,
    memory: initialMemory(difficulty, now),
    attempts: 0,
    correct: 0,
    lastSeen: now
  }
}

export function updateMastery(rec: MasteryRecord, correct: boolean, now = Date.now(), difficultyHint = 3): MasteryRecord {
  const grade = correct ? (difficultyHint >= 3 ? 5 : 4) : (difficultyHint <= 1 ? 0 : 2)
  return {
    ...rec,
    pKnown: bktUpdate(rec.pKnown, correct),
    memory: scheduleReview(rec.memory, grade, now),
    attempts: rec.attempts + 1,
    correct: rec.correct + (correct ? 1 : 0),
    lastSeen: now
  }
}

/** 综合掌握度：BKT 概率 70% + 当前记忆可提取性 30% */
export function masteryPercent(rec: MasteryRecord, now = Date.now()): number {
  return Math.round(100 * (0.7 * rec.pKnown + 0.3 * retrievability(rec.memory, now)))
}

export function isDue(rec: MasteryRecord, now = Date.now(), targetR = 0.9): boolean {
  return retrievability(rec.memory, now) < targetR
}

/** 复习优先级：遗忘程度 × 未掌握程度 ×  lapse 加权 */
export function reviewPriority(rec: MasteryRecord, now = Date.now()): number {
  const r = retrievability(rec.memory, now)
  return (1 - r) * (1 - rec.pKnown) * (1 + Math.min(1, rec.memory.lapses * 0.2))
}

export function dueKnowledge(records: MasteryRecord[], now = Date.now(), targetR = 0.9): MasteryRecord[] {
  return records
    .filter((r) => isDue(r, now, targetR))
    .sort((a, b) => reviewPriority(b, now) - reviewPriority(a, now))
}

export function masterySummary(records: MasteryRecord[], now = Date.now()): {
  count: number
  average: number
  mastered: number
  due: number
  weakest: MasteryRecord | null
} {
  if (!records.length) return { count: 0, average: 0, mastered: 0, due: 0, weakest: null }
  const scores = records.map((r) => masteryPercent(r, now))
  const weakest = records.reduce((a, b) => (reviewPriority(b, now) > reviewPriority(a, now) ? b : a))
  return {
    count: records.length,
    average: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
    mastered: records.filter((r) => r.pKnown >= 0.85).length,
    due: dueKnowledge(records, now).length,
    weakest
  }
}
