/**
 * V3.1（方案 §3.2）：progress.ts 转发到 learning/db 持久层的桥接测试。
 * 目标是证明「同步 API 不变 + 数据进 IndexedDB + 旧数据可迁移 + 多档案不串数据」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string): void { this.m.set(k, String(v)) }
  removeItem(k: string): void { this.m.delete(k) }
  clear(): void { this.m.clear() }
  get length(): number { return this.m.size }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null }
}
const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })

import {
  getProgress, markQuiz, markDone, entryScore, overallProgress, weakExperiments,
  hydrateProgress, switchProgressProfile, flushProgress, progressBridgeStatus
} from '../src/store/progress'
import { labDB, setActiveProfile } from '../src/learning/db'

const KEY = 'scilab.progress.v1'
const REC = (p: string): string => `progress.v2.${p}`
type Rec = { id: string; value: Record<string, { preview: number | null; done: boolean; review: number | null }>; [key: string]: unknown }

/** 每个用例前清空 localStorage 与持久层中的进度记录，恢复到冷启动状态 */
async function reset(): Promise<void> {
  storage.clear()
  const all = await labDB.getAll<{ id: string }>('settings')
  for (const r of all) if (r.id.startsWith('progress.v2.')) await labDB.delete('settings', r.id)
  await setActiveProfile('profile.default')
  await switchProgressProfile('profile.default')
  await flushProgress()
}

test('同步桥：markQuiz/markDone 同时写 localStorage 与持久层，V2 API 语义不变', async () => {
  await reset()
  markQuiz('physics.pendulum', 'preview', 80)
  markQuiz('physics.pendulum', 'review', 40)
  markDone('physics.pendulum')

  const local = JSON.parse(storage.getItem(KEY) ?? '{}') as Record<string, { preview: number; done: boolean; review: number }>
  assert.equal(local['physics.pendulum'].preview, 80)
  assert.equal(local['physics.pendulum'].review, 40)
  assert.equal(local['physics.pendulum'].done, true)

  await flushProgress()
  const rec = await labDB.get<Rec>('settings', REC('profile.default'))
  assert.equal(rec?.value['physics.pendulum'].review, 40, '进度应已进入新持久层')

  assert.equal(getProgress()['physics.pendulum'].preview, 80)
  assert.equal(entryScore({ preview: 80, done: true, review: 40 }), 80)
  assert.equal(overallProgress(['physics.pendulum']), 80)
  assert.deepEqual(weakExperiments(), [{ id: 'physics.pendulum', review: 40 }])
  assert.equal(progressBridgeStatus().hydrated, true)
  assert.equal(progressBridgeStatus().profile, 'profile.default')
})

test('getProgress 返回深拷贝，外部改动不会污染内存镜像', async () => {
  await reset()
  markQuiz('physics.pendulum', 'preview', 60)
  const snap = getProgress()
  snap['physics.pendulum'].preview = 0
  delete snap['physics.pendulum']
  assert.equal(getProgress()['physics.pendulum'].preview, 60)
})

test('首次启动：V2 localStorage 进度自动迁移到 V3 持久层', async () => {
  await reset()
  storage.setItem(KEY, JSON.stringify({ 'physics.shm': { preview: 100, done: true, review: 90 } }))
  const first = await hydrateProgress('profile.default')
  assert.equal(first.migrated, true)
  assert.equal(first.restored, false)
  await flushProgress()
  const rec = await labDB.get<Rec>('settings', REC('profile.default'))
  assert.equal(rec?.value['physics.shm'].review, 90)
  const second = await hydrateProgress('profile.default')
  assert.equal(second.restored, true, '第二次启动应命中持久层')
  assert.equal(second.migrated, false)
})

test('多档案：新档案不继承别的档案的本地进度，切回可恢复', async () => {
  await reset()
  markQuiz('physics.pendulum', 'preview', 70)
  await flushProgress()

  const fresh = await hydrateProgress('profile.studentB')
  assert.equal(fresh.restored, false)
  assert.equal(fresh.migrated, false, '已有其他档案时，新档案不得继承 V2 本地数据')
  assert.deepEqual(getProgress(), {})

  markQuiz('physics.shm', 'review', 30)
  await flushProgress()
  const recB = await labDB.get<Rec>('settings', REC('profile.studentB'))
  assert.equal(recB?.value['physics.shm'].review, 30)
  assert.equal(recB?.value['physics.pendulum'], undefined, '不得串入默认档案的进度')

  const back = await hydrateProgress('profile.default')
  assert.equal(back.restored, true)
  assert.equal(getProgress()['physics.pendulum'].preview, 70)
  assert.equal(getProgress()['physics.shm'], undefined)
})
