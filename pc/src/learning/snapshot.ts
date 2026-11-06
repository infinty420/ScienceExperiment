/**
 * 可复现实验快照 v3
 *
 * 借鉴 PhET「可测量、可复现」的产品理念（GPL-3.0，仅理念，零代码复用）与
 * CODAP (MIT) 的案例数据结构思想。快照携带参数、求解器配置、随机种子、
 * 原始数据与校验和；导入后可复跑并逐点比对，验证「同一输入 → 同一输出」。
 */
import { hashObject, shortHash } from '../report/hash'
import { compileSystem } from '../kernel/expr'
import { integrate, type Derivative } from '../kernel/ode'
import type { SolverSpec } from '../experiments/schema'
import type { StoredRecord } from './db'

export const SNAPSHOT_SCHEMA = 'scilab.snapshot.v3'

export interface ExperimentSnapshot extends StoredRecord {
  id: string
  schema: typeof SNAPSHOT_SCHEMA
  experimentId: string
  title: string
  createdAt: number
  profileId: string
  params: Record<string, number>
  paramLabels?: Record<string, string>
  solver?: SolverSpec
  seed: number | string
  rows: number[][]
  resultLines: string[]
  fit?: { label: string; params: number[]; r2: number }
  energyDrift?: number
  source: 'experiment' | 'research' | 'imported'
  checksum: string
}

export interface SnapshotInput {
  experimentId: string
  title: string
  params: Record<string, number>
  rows: number[][]
  resultLines?: string[]
  solver?: SolverSpec
  seed?: number | string
  paramLabels?: Record<string, string>
  fit?: ExperimentSnapshot['fit']
  energyDrift?: number
  profileId?: string
  source?: ExperimentSnapshot['source']
  createdAt?: number
}

/** 校验和覆盖范围：除 id 与 checksum 自身之外的全部字段（两者都是产物，不是输入） */
function payload(s: ExperimentSnapshot): Record<string, unknown> {
  // 先按 JSON 语义归一化：undefined 字段在序列化时会消失，
  // 否则「内存中新建」与「文件导入后」的校验和会不一致。
  const clean = JSON.parse(JSON.stringify(s)) as ExperimentSnapshot
  const { checksum: _checksum, id: _id, ...rest } = clean
  void _checksum
  void _id
  return rest as unknown as Record<string, unknown>
}

export function createSnapshot(input: SnapshotInput): ExperimentSnapshot {
  const createdAt = input.createdAt ?? Date.now()
  const seed = input.seed ?? 20261106
  const base: ExperimentSnapshot = {
    id: '',
    schema: SNAPSHOT_SCHEMA,
    experimentId: input.experimentId,
    title: input.title,
    createdAt,
    profileId: input.profileId ?? 'profile.default',
    params: { ...input.params },
    paramLabels: input.paramLabels ? { ...input.paramLabels } : undefined,
    solver: input.solver ? JSON.parse(JSON.stringify(input.solver)) : undefined,
    seed,
    rows: input.rows.map((r) => r.slice()),
    resultLines: (input.resultLines ?? []).slice(),
    fit: input.fit,
    energyDrift: input.energyDrift,
    source: input.source ?? 'experiment',
    checksum: ''
  }
  const checksum = hashObject(payload(base))
  base.checksum = checksum
  base.id = `snap.${createdAt}.${shortHash(checksum, 10)}`
  return base
}

export function verifySnapshot(s: ExperimentSnapshot): boolean {
  if (!s || s.schema !== SNAPSHOT_SCHEMA) return false
  try {
    const expect = hashObject(payload(s))
    return expect === s.checksum
  } catch {
    return false
  }
}

export function serializeSnapshot(s: ExperimentSnapshot): string {
  return JSON.stringify({ format: SNAPSHOT_SCHEMA, snapshot: s }, null, 2)
}

export function parseSnapshot(text: string): { ok: boolean; snapshot?: ExperimentSnapshot; error?: string } {
  try {
    const obj = JSON.parse(text) as { snapshot?: ExperimentSnapshot } & Partial<ExperimentSnapshot>
    const s = obj.snapshot ?? (obj as ExperimentSnapshot)
    if (!s || s.schema !== SNAPSHOT_SCHEMA) return { ok: false, error: `快照格式不符，期望 ${SNAPSHOT_SCHEMA}` }
    if (!Array.isArray(s.rows) || typeof s.checksum !== 'string') return { ok: false, error: '快照缺少 rows / checksum' }
    if (!verifySnapshot(s)) return { ok: false, error: '校验和不匹配：快照可能被修改或损坏' }
    return { ok: true, snapshot: s }
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

export interface ReplayResult {
  ok: boolean
  matches: boolean
  reason?: string
  regeneratedRows: number[][]
  maxAbsDiff: number
  compared: number
  diagnostics?: {
    solver: string
    steps: number
    rejected: number
    maxEnergyDrift: number
  }
}

/** 用内核重新积分，逐点比对原始快照数据 */
export function replaySnapshot(s: ExperimentSnapshot, tolerance = 1e-3): ReplayResult {
  const spec = s.solver
  if (!spec?.equations?.length) {
    return { ok: false, matches: false, reason: '该快照未携带 solver.equations，无法数值复跑', regeneratedRows: [], maxAbsDiff: 0, compared: 0 }
  }
  const equations = spec.equations
  const names = equations.map((_, i) => spec.stateNames?.[i] ?? `y${i}`)
  const sys = compileSystem(equations, names, spec.paramNames ?? [])
  const f: Derivative = (t, y) => sys.derivative(t, y, s.params)
  const y0 = names.map((_, i) => spec.initial?.[i] ?? 0)
  const traj = integrate(f, y0, 0, spec.tEnd ?? 10, {
    solver: spec.solver ?? 'rk4',
    dt: spec.dt ?? 0.02,
    rtol: spec.rtol,
    atol: spec.atol,
    maxPoints: 4000
  })
  const cols = s.rows[0]?.length ?? Math.min(2, names.length + 1)
  const regeneratedRows = traj.points.map((p) => [p.t, ...p.y].slice(0, cols))
  const compared = Math.min(s.rows.length, regeneratedRows.length)
  let maxAbsDiff = 0
  for (let i = 0; i < compared; i++) {
    const a = s.rows[i]
    const b = regeneratedRows[i]
    for (let j = 0; j < Math.min(a.length, b.length); j++) {
      maxAbsDiff = Math.max(maxAbsDiff, Math.abs(a[j] - b[j]))
    }
  }
  return {
    ok: true,
    matches: compared > 0 && maxAbsDiff <= tolerance,
    regeneratedRows,
    maxAbsDiff,
    compared,
    diagnostics: {
      solver: traj.solver,
      steps: traj.diagnostics.steps,
      rejected: traj.diagnostics.rejected,
      maxEnergyDrift: traj.diagnostics.maxEnergyDrift
    }
  }
}

export function compareSnapshots(a: ExperimentSnapshot, b: ExperimentSnapshot): {
  sameChecksum: boolean
  changedParams: string[]
  rowCountDiff: number
  maxRowDiff: number
} {
  const keys = new Set([...Object.keys(a.params), ...Object.keys(b.params)])
  const changedParams = [...keys].filter((k) => a.params[k] !== b.params[k])
  const n = Math.min(a.rows.length, b.rows.length)
  let maxRowDiff = 0
  for (let i = 0; i < n; i++) {
    const ra = a.rows[i]
    const rb = b.rows[i]
    for (let j = 0; j < Math.min(ra.length, rb.length); j++) maxRowDiff = Math.max(maxRowDiff, Math.abs(ra[j] - rb[j]))
  }
  return { sameChecksum: a.checksum === b.checksum, changedParams, rowCountDiff: a.rows.length - b.rows.length, maxRowDiff }
}
