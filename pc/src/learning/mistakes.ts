/**
 * 错题本 + 间隔重复复习队列
 * 错因按知识点归类，复习排程复用 mastery 的 D/S/R 模型；毕业阈值 = 连续 3 次正确且掌握度达标。
 */
import type { StoredRecord } from './db'
import { initialMemory, nextReviewAt, scheduleReview, retrievability, type MemoryState } from './mastery'

export interface MistakeCard extends StoredRecord {
  id: string
  experimentId: string
  question: string
  options: string[]
  answer: number
  chosen: number
  explain: string
  knowledge: string
  createdAt: number
  dueAt: number
  streak: number
  lapses: number
  graduated: boolean
  memory: MemoryState
}

export interface MistakeInput {
  experimentId: string
  question: string
  options: string[]
  answer: number
  chosen: number
  explain: string
  knowledge?: string
}

export function makeCard(input: MistakeInput, now = Date.now()): MistakeCard {
  const memory = initialMemory(5, now)
  return {
    id: `card.${input.experimentId}.${now}.${Math.abs(hashString(input.question))}`,
    experimentId: input.experimentId,
    question: input.question,
    options: input.options.slice(),
    answer: input.answer,
    chosen: input.chosen,
    explain: input.explain,
    knowledge: input.knowledge ?? input.experimentId.split('.')[0],
    createdAt: now,
    dueAt: nextReviewAt(memory, 0.9),
    streak: 0,
    lapses: 0,
    graduated: false,
    memory
  }
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h
}

/** 复习一张卡：正确累计连续次数，答错重置并缩短间隔 */
export function reviewMistake(card: MistakeCard, correct: boolean, now = Date.now()): MistakeCard {
  const memory = scheduleReview(card.memory, correct ? 5 : 1, now)
  const streak = correct ? card.streak + 1 : 0
  const lapses = card.lapses + (correct ? 0 : 1)
  return {
    ...card,
    memory,
    streak,
    lapses,
    dueAt: nextReviewAt(memory, 0.9),
    graduated: streak >= 3 && retrievability(memory, now) > 0.85
  }
}

export function dueMistakes(cards: MistakeCard[], now = Date.now()): MistakeCard[] {
  return cards
    .filter((c) => !c.graduated && c.dueAt <= now)
    .sort((a, b) => (a.dueAt - b.dueAt) || (b.lapses - a.lapses))
}

export function mistakeStats(cards: MistakeCard[], now = Date.now()): {
  total: number
  due: number
  graduated: number
  byKnowledge: Record<string, number>
  accuracy: number
} {
  const byKnowledge: Record<string, number> = {}
  for (const c of cards) byKnowledge[c.knowledge] = (byKnowledge[c.knowledge] ?? 0) + 1
  const attempts = cards.reduce((s, c) => s + c.streak + c.lapses, 0)
  const correct = cards.reduce((s, c) => s + c.streak, 0)
  return {
    total: cards.length,
    due: dueMistakes(cards, now).length,
    graduated: cards.filter((c) => c.graduated).length,
    byKnowledge,
    accuracy: attempts ? Math.round(100 * correct / attempts) : 0
  }
}

/** 从题库作答结果批量生成错题卡（同题去重，避免重复堆积） */
export function collectMistakes(
  answers: Array<{ q: string; options: string[]; answer: number; chosen: number; explain: string; knowledge?: string }>,
  experimentId: string,
  existing: MistakeCard[],
  now = Date.now()
): MistakeCard[] {
  const known = new Set(existing.map((c) => c.question))
  const out: MistakeCard[] = []
  for (const a of answers) {
    if (a.chosen === a.answer || known.has(a.q)) continue
    out.push(makeCard({
      experimentId,
      question: a.q,
      options: a.options,
      answer: a.answer,
      chosen: a.chosen,
      explain: a.explain,
      knowledge: a.knowledge
    }, now))
    known.add(a.q)
  }
  return out
}
