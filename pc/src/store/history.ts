/**
 * 实验历史存储（W8）：localStorage 持久化。
 * V2：增加考核模式标记与得分。
 * W11 云同步时此层替换为「本地队列 + 云端备份」。
 */
export interface HistoryEntry {
  experimentId: string
  title: string
  subject: string
  date: string
  params: Record<string, number>
  paramLabels: Record<string, string>
  resultLines: string[]
  rowCount: number
  /** V2：practice 练习 / exam 考核 */
  mode?: 'practice' | 'exam'
  /** V2：考核得分（0–100） */
  score?: number
}

const KEY = 'scilab.history.v1'

export function getHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : []
  } catch {
    return []
  }
}

/** 考核成绩独立保存（不覆盖练习记录）；练习成绩同实验覆盖保留最新 */
export function saveHistory(entry: HistoryEntry): void {
  const list = getHistory().filter(
    (e) => !(e.experimentId === entry.experimentId && (e.mode ?? 'practice') === (entry.mode ?? 'practice'))
  )
  list.unshift(entry)
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 100)))
  } catch {
    /* 存储满则忽略 */
  }
}

export function clearHistory(): void {
  localStorage.removeItem(KEY)
}
