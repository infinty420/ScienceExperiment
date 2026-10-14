/**
 * 实验历史存储（W8）：localStorage 持久化。
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

/** 同一实验重复完成则覆盖（保留最新成绩） */
export function saveHistory(entry: HistoryEntry): void {
  const list = getHistory().filter((e) => e.experimentId !== entry.experimentId)
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
