/**
 * 实验包注册中心：编译期内置包 + 运行时导入包（V3 可插拔）
 *
 * 鸿蒙 WebView 以 resource:// 加载，禁止运行时 fetch JSON；因此内置包仍由
 * import.meta.glob 编译期内联，导入包只从内存字符串注册，不产生任何网络请求。
 */
import { sha256Hex } from '../report/hash'
import { stableStringify } from '../kernel/rng'
import { DSL_VERSION, type ExperimentPackage, type SceneDefV2 } from './schema'
import { validatePackage, type ValidationReport } from './validate'
import type { QuizDef } from './types'

export const PACKAGE_FORMAT = 'scilab.experiment.v2'
const STORAGE_KEY = 'scilab.packages.v2'

const registry = new Map<string, ExperimentPackage>()
const reports = new Map<string, ValidationReport>()

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** V1 → V2 迁移：补元数据、统一包装结构，绝不修改原始对象 */
export function migrateToV2(raw: unknown, source: 'builtin' | 'imported' = 'imported'): ExperimentPackage {
  if (typeof raw !== 'object' || raw === null) throw new Error('实验包必须是 JSON 对象')
  const obj = raw as Record<string, unknown>
  const wrapped = obj.scene ? obj : { scene: obj, quiz: obj.quiz }
  const scene = clone(wrapped.scene) as SceneDefV2
  const quiz = wrapped.quiz ? (clone(wrapped.quiz) as QuizDef) : undefined
  if (!scene || typeof scene !== 'object') throw new Error('缺少 scene 对象')
  scene.meta = { ...(scene.meta ?? {}), dslVersion: DSL_VERSION } as SceneDefV2['meta']
  return {
    scene,
    quiz,
    source,
    importedAt: source === 'imported' ? new Date().toISOString() : undefined,
    checksum: sha256Hex(stableStringify(scene))
  }
}

function persistImported(): void {
  try {
    if (typeof localStorage === 'undefined') return
    const imported = [...registry.values()].filter((p) => p.source === 'imported')
    localStorage.setItem(STORAGE_KEY, JSON.stringify(imported))
  } catch {
    /* 存储不可用时保持内存态即可 */
  }
}

function restoreImported(): void {
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    for (const item of JSON.parse(raw) as ExperimentPackage[]) {
      if (item?.scene?.id) registry.set(item.scene.id, { ...item, source: 'imported' })
    }
  } catch {
    /* 忽略损坏的本地缓存 */
  }
}
restoreImported()

/** 注册编译期内置包（不阻断加载，仅收集校验报告） */
export function registerBuiltin(scene: SceneDefV2, quiz?: QuizDef): void {
  const pkg = migrateToV2({ scene, quiz }, 'builtin')
  registry.set(pkg.scene.id, pkg)
  reports.set(pkg.scene.id, validatePackage(pkg))
}

export interface RegisterResult {
  ok: boolean
  id: string
  report: ValidationReport
  pkg?: ExperimentPackage
  error?: string
}

/** 导入外部实验包：迁移 → 校验 → 覆盖注册（有错误则拒绝） */
export function registerPackage(input: string | object): RegisterResult {
  let pkg: ExperimentPackage
  try {
    const raw = typeof input === 'string' ? JSON.parse(input) : input
    pkg = migrateToV2(raw, 'imported')
  } catch (e) {
    return {
      ok: false, id: '',
      report: { ok: false, issues: [{ path: '$', message: e instanceof Error ? e.message : String(e), severity: 'error' }], errors: 1, warnings: 0 },
      error: 'JSON 解析失败'
    }
  }
  const report = validatePackage(pkg)
  const id = String(pkg.scene?.id ?? '')
  if (!report.ok || !id) {
    return { ok: false, id, report, error: '校验未通过，已拒绝注册' }
  }
  registry.set(id, pkg)
  reports.set(id, report)
  persistImported()
  return { ok: true, id, report, pkg }
}

export function getPackage(id: string): ExperimentPackage | undefined {
  return registry.get(id)
}

export function getRegisteredScene(id: string): SceneDefV2 | undefined {
  return registry.get(id)?.scene
}

export function getRegisteredQuiz(id: string): QuizDef | undefined {
  return registry.get(id)?.quiz
}

export function listPackages(source?: 'builtin' | 'imported'): ExperimentPackage[] {
  const all = [...registry.values()]
  return source ? all.filter((p) => p.source === source) : all
}

export function getPackageReport(id: string): ValidationReport | undefined {
  return reports.get(id)
}

export function allPackageIssues(): Array<{ id: string; report: ValidationReport }> {
  return [...reports.entries()].filter(([, r]) => r.issues.length > 0).map(([id, report]) => ({ id, report }))
}

export function unregisterPackage(id: string): boolean {
  const existed = registry.delete(id)
  reports.delete(id)
  persistImported()
  return existed
}

/** 导出为可分享的 JSON（含 quiz 与校验和） */
export function exportPackage(id: string): string | null {
  const pkg = registry.get(id)
  if (!pkg) return null
  return JSON.stringify({
    format: PACKAGE_FORMAT,
    exportedAt: new Date().toISOString(),
    scene: pkg.scene,
    quiz: pkg.quiz
  }, null, 2)
}

export function packageStats(): { total: number; builtin: number; imported: number; errors: number; warnings: number } {
  const all = listPackages()
  let errors = 0
  let warnings = 0
  for (const r of reports.values()) { errors += r.errors; warnings += r.warnings }
  return {
    total: all.length,
    builtin: all.filter((p) => p.source === 'builtin').length,
    imported: all.filter((p) => p.source === 'imported').length,
    errors,
    warnings
  }
}
