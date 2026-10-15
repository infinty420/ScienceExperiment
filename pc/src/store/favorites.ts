/**
 * V3 收藏与最近使用（localStorage 持久化，PC 端）。
 */

const FAV_KEY = 'scilab.favorites.v1'
const RECENT_KEY = 'scilab.recent.v1'

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? (arr as string[]) : []
  } catch {
    return []
  }
}

function write(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    /* 存储满则忽略 */
  }
}

/* ── 收藏 ── */
export function getFavorites(): string[] {
  return read(FAV_KEY)
}

export function isFavorite(id: string): boolean {
  return read(FAV_KEY).includes(id)
}

/** 切换收藏态，返回切换后是否已收藏 */
export function toggleFavorite(id: string): boolean {
  const list = read(FAV_KEY)
  const i = list.indexOf(id)
  if (i >= 0) list.splice(i, 1)
  else list.push(id)
  write(FAV_KEY, list.slice(0, 50))
  return i < 0
}

/* ── 最近使用 ── */
export function getRecent(): string[] {
  return read(RECENT_KEY)
}

export function pushRecent(id: string): void {
  const list = read(RECENT_KEY).filter((x) => x !== id)
  list.unshift(id)
  write(RECENT_KEY, list.slice(0, 8))
}
