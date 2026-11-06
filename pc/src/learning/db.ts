/**
 * 学习数据持久层（IndexedDB，无第三方依赖）
 *
 * 鸿蒙 WebView 若不提供 IndexedDB，自动降级为内存 + localStorage 镜像，
 * 保证功能不崩；所有 API 均为异步，旧版 localStorage store 保持同步兼容。
 */
export const STORES = ['runs', 'attempts', 'cards', 'snapshots', 'profiles', 'settings'] as const
export type StoreName = typeof STORES[number]

export interface StoredRecord { id: string; [key: string]: unknown }
export type DBEngine = 'indexeddb' | 'memory'

const MIRROR_KEY = 'scilab.db.v3'
const DB_NAME = 'scilab.v3'
const DB_VERSION = 1

interface LegacyKeys {
  history: string
  progress: string
  favorites: string
  recent: string
}

const LEGACY_KEYS: LegacyKeys = {
  history: 'scilab.history.v1',
  progress: 'scilab.progress.v1',
  favorites: 'scilab.favorites.v1',
  recent: 'scilab.recent.v1'
}

function openIndexedDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const d = req.result
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

class LabDB {
  private engine: DBEngine = 'memory'
  private connection: IDBDatabase | null = null
  private memory = new Map<StoreName, Map<string, StoredRecord>>()
  private opened = false

  constructor() {
    for (const s of STORES) this.memory.set(s, new Map())
    this.restoreMirror()
  }

  private restoreMirror(): void {
    try {
      if (typeof localStorage === 'undefined') return
      const raw = localStorage.getItem(MIRROR_KEY)
      if (!raw) return
      const data = JSON.parse(raw) as Partial<Record<StoreName, StoredRecord[]>>
      for (const s of STORES) {
        const rows = data[s] ?? []
        const m = this.memory.get(s)!
        for (const r of rows) if (r?.id) m.set(r.id, r)
      }
    } catch { /* 损坏缓存忽略 */ }
  }

  private mirror(): void {
    try {
      if (typeof localStorage === 'undefined') return
      const data: Partial<Record<StoreName, StoredRecord[]>> = {}
      for (const s of STORES) data[s] = [...this.memory.get(s)!.values()]
      localStorage.setItem(MIRROR_KEY, JSON.stringify(data))
    } catch { /* 配额不足时保持内存态 */ }
  }

  async init(): Promise<DBEngine> {
    if (this.opened) return this.engine
    this.opened = true
    this.connection = await openIndexedDB()
    this.engine = this.connection ? 'indexeddb' : 'memory'
    return this.engine
  }

  status(): { engine: DBEngine; opened: boolean; counts: Record<string, number> } {
    const counts: Record<string, number> = {}
    for (const s of STORES) counts[s] = this.memory.get(s)!.size
    return { engine: this.engine, opened: this.opened, counts }
  }

  async put<T extends StoredRecord>(store: StoreName, value: T): Promise<void> {
    await this.init()
    this.memory.get(store)!.set(value.id, value)
    this.mirror()
    const conn = this.connection
    if (!conn) return
    try {
      await new Promise<void>((resolve) => {
        const tx = conn.transaction(store, 'readwrite')
        tx.objectStore(store).put(value)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
    } catch { /* 事务失败不影响内存态 */ }
  }

  async get<T extends StoredRecord>(store: StoreName, id: string): Promise<T | undefined> {
    await this.init()
    const hit = this.memory.get(store)!.get(id)
    if (hit) return hit as T
    const conn = this.connection
    if (!conn) return undefined
    try {
      return await new Promise<T | undefined>((resolve) => {
        const tx = conn.transaction(store, 'readonly')
        const req = tx.objectStore(store).get(id)
        req.onsuccess = () => resolve(req.result as T | undefined)
        req.onerror = () => resolve(undefined)
      })
    } catch { return undefined }
  }

  async getAll<T extends StoredRecord>(store: StoreName): Promise<T[]> {
    await this.init()
    if (!this.connection) return [...this.memory.get(store)!.values()] as T[]
    try {
      const fromDB = await new Promise<T[]>((resolve) => {
        const tx = this.connection!.transaction(store, 'readonly')
        const req = tx.objectStore(store).getAll()
        req.onsuccess = () => resolve((req.result ?? []) as T[])
        req.onerror = () => resolve([])
      })
      const merged = new Map<string, StoredRecord>()
      for (const r of this.memory.get(store)!.values()) merged.set(r.id, r)
      for (const r of fromDB) if (r?.id) merged.set(r.id, r)
      for (const [id, r] of merged) this.memory.get(store)!.set(id, r)
      return [...merged.values()] as T[]
    } catch {
      return [...this.memory.get(store)!.values()] as T[]
    }
  }

  async delete(store: StoreName, id: string): Promise<void> {
    await this.init()
    this.memory.get(store)!.delete(id)
    this.mirror()
    const conn = this.connection
    if (!conn) return
    try {
      await new Promise<void>((resolve) => {
        const tx = conn.transaction(store, 'readwrite')
        tx.objectStore(store).delete(id)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
    } catch { /* ignore */ }
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    await this.put('settings', { id: key, value } as unknown as StoredRecord)
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const rec = await this.get<StoredRecord>('settings', key)
    return rec?.value as T | undefined
  }

  /** 把 V2 的 4 个 localStorage 键迁移到 V3 数据结构（只导入一次） */
  async migrateLegacy(): Promise<{ imported: number; skipped: boolean }> {
    await this.init()
    if (typeof localStorage === 'undefined') return { imported: 0, skipped: true }
    const flag = await this.getSetting<boolean>('legacy.migrated')
    if (flag) return { imported: 0, skipped: true }
    let count = 0
    try {
      const history = JSON.parse(localStorage.getItem(LEGACY_KEYS.history) ?? '[]') as Array<Record<string, unknown>>
      for (const [i, h] of history.entries()) {
        await this.put('runs', { id: `legacy.run.${i}`, source: 'legacy', ...h })
        count++
      }
      const progress = JSON.parse(localStorage.getItem(LEGACY_KEYS.progress) ?? '{}') as Record<string, unknown>
      for (const [id, p] of Object.entries(progress)) {
        await this.put('attempts', { id: `legacy.progress.${id}`, experimentId: id, source: 'legacy', value: p })
        count++
      }
      const favorites = JSON.parse(localStorage.getItem(LEGACY_KEYS.favorites) ?? '[]') as string[]
      await this.put('settings', { id: 'favorites', value: favorites, source: 'legacy' })
      const recent = JSON.parse(localStorage.getItem(LEGACY_KEYS.recent) ?? '[]') as string[]
      await this.put('settings', { id: 'recent', value: recent, source: 'legacy' })
      await this.setSetting('legacy.migrated', true)
    } catch { /* 单个键损坏不阻断 */ }
    return { imported: count, skipped: false }
  }
}

export const labDB = new LabDB()

/** 多档案：本地多学生共用一台设备 */
export interface Profile extends StoredRecord {
  id: string
  name: string
  createdAt: number
  color: string
}

export async function ensureDefaultProfile(): Promise<Profile> {
  const all = await labDB.getAll<Profile>('profiles')
  if (all.length) return all[0]
  const p: Profile = { id: 'profile.default', name: '默认学习者', createdAt: Date.now(), color: '#3f8f79' }
  await labDB.put('profiles', p)
  return p
}

export async function activeProfileId(): Promise<string> {
  return (await labDB.getSetting<string>('activeProfileId')) ?? 'profile.default'
}

export async function setActiveProfile(id: string): Promise<void> {
  await labDB.setSetting('activeProfileId', id)
}
