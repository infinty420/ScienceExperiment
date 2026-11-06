/**
 * 实验包 DSL v2 校验器（自研 JSON-Schema 子集 + 语义校验，零依赖）
 *
 * 参考 physviz-engine (Apache-2.0) 「先验证再加载」的工程习惯。
 * 目标：外部导入的实验包在注册前即可定位到「哪个字段、什么问题」。
 */
import { validateExpression } from '../kernel/expr'
import { dimensionOf } from '../kernel/units'
import { DSL_VERSION, KNOWN_SPDX, type ExperimentPackage, type SceneDefV2 } from './schema'
import type { QuizDef } from './types'

export type Severity = 'error' | 'warning'
export interface ValidationIssue {
  path: string
  message: string
  severity: Severity
}
export interface ValidationReport {
  ok: boolean
  issues: ValidationIssue[]
  errors: number
  warnings: number
}

export type Rule =
  | { type: 'object'; required?: string[]; props?: Record<string, Rule>; allowExtra?: boolean }
  | { type: 'array'; items?: Rule; minItems?: number }
  | { type: 'string'; pattern?: RegExp; minLength?: number; enum?: string[] }
  | { type: 'number'; min?: number; max?: number; integer?: boolean }
  | { type: 'boolean' }
  | { type: 'any' }
  | { type: 'union'; of: Rule[] }

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function typeName(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

/** 通用结构校验：返回带路径的问题列表 */
export function validateValue(value: unknown, rule: Rule, path = '$', issues: ValidationIssue[] = []): ValidationIssue[] {
  const err = (message: string): void => { issues.push({ path, message, severity: 'error' }) }
  switch (rule.type) {
    case 'any': break
    case 'object': {
      if (!isObject(value)) { err(`应为对象，实际为 ${typeName(value)}`); break }
      for (const key of rule.required ?? []) {
        if (!(key in value)) err(`缺少必填字段 ${key}`)
      }
      for (const [key, sub] of Object.entries(rule.props ?? {})) {
        if (key in value) validateValue(value[key], sub, `${path}.${key}`, issues)
      }
      if (rule.allowExtra === false) {
        const known = new Set([...(rule.required ?? []), ...Object.keys(rule.props ?? {})])
        for (const key of Object.keys(value)) if (!known.has(key)) err(`不允许的字段 ${key}`)
      }
      break
    }
    case 'array': {
      if (!Array.isArray(value)) { err(`应为数组，实际为 ${typeName(value)}`); break }
      if (rule.minItems !== undefined && value.length < rule.minItems) err(`至少需要 ${rule.minItems} 项，实际 ${value.length}`)
      if (rule.items) value.forEach((item, i) => validateValue(item, rule.items!, `${path}[${i}]`, issues))
      break
    }
    case 'string': {
      if (typeof value !== 'string') { err(`应为字符串，实际为 ${typeName(value)}`); break }
      if (rule.minLength !== undefined && value.length < rule.minLength) err(`长度至少 ${rule.minLength}`)
      if (rule.pattern && !rule.pattern.test(value)) err(`不匹配 ${rule.pattern}`)
      if (rule.enum && !rule.enum.includes(value)) err(`取值须为 ${rule.enum.join(' / ')}`)
      break
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) { err(`应为有限数值，实际为 ${String(value)}`); break }
      if (rule.integer && !Number.isInteger(value)) err('应为整数')
      if (rule.min !== undefined && value < rule.min) err(`不应小于 ${rule.min}`)
      if (rule.max !== undefined && value > rule.max) err(`不应大于 ${rule.max}`)
      break
    }
    case 'boolean': {
      if (typeof value !== 'boolean') err(`应为布尔值，实际为 ${typeName(value)}`)
      break
    }
    case 'union': {
      const before = issues.length
      const branches = rule.of.map((sub) => {
        const branch: ValidationIssue[] = []
        validateValue(value, sub, path, branch)
        return branch
      })
      if (!branches.some((b) => b.length === 0)) {
        // 取问题最少的分支上报，避免刷屏
        const best = branches.reduce((a, b) => (b.length < a.length ? b : a))
        issues.push(...best.length ? best : [{ path, message: '不匹配任何允许的类型', severity: 'error' as Severity }])
      }
      void before
      break
    }
  }
  return issues
}

const num = (min?: number, max?: number): Rule => ({ type: 'number', min, max })
const str = (minLength = 1): Rule => ({ type: 'string', minLength })
const arr = (items: Rule, minItems = 0): Rule => ({ type: 'array', items, minItems })

const PARAM_RULE: Rule = {
  type: 'object',
  required: ['id', 'label', 'min', 'max', 'step', 'value'],
  props: {
    id: str(), label: str(), min: num(), max: num(), step: num(1e-9), value: num(), unit: str()
  }
}
const OBJECT_RULE: Rule = {
  type: 'object',
  required: ['id', 'type', 'position'],
  props: {
    id: str(), type: str(), position: arr(num(), 3), size: arr(num()), color: str(),
    rotation: arr(num(), 3), mass: num(0), friction: num(0), static: { type: 'boolean' },
    visible: { type: 'boolean' }, noPhysics: { type: 'boolean' }, velocity: arr(num(), 3)
  }
}
const SCENE_RULE: Rule = {
  type: 'object',
  required: ['id', 'title', 'camera', 'objects', 'params', 'records', 'guide'],
  props: {
    id: { type: 'string', pattern: /^[A-Za-z0-9._-]+$/ },
    title: str(),
    physics: { type: 'object', props: { gravity: num() } },
    camera: {
      type: 'object', required: ['position', 'target'],
      props: { position: arr(num(), 3), target: arr(num(), 3) }
    },
    ground: { type: 'object', props: { size: num(0) } },
    objects: arr(OBJECT_RULE),
    params: arr(PARAM_RULE, 1),
    // 定性观察类实验（如显微镜、细胞结构）允许 records 为空
    records: arr({
      type: 'object', required: ['id', 'label'],
      props: { id: str(), label: str(), digits: num(0), sigma: num(0) }
    }, 0),
    guide: str(),
    curve: {
      type: 'object', required: ['x', 'y'],
      props: { x: str(), y: str(), title: str() }
    },
    instruments: arr({
      type: 'object', required: ['id', 'type', 'label'],
      props: {
        id: str(), type: str(), label: str(), unit: str(), digits: num(0),
        range: arr(num(), 2), recordColumn: str()
      }
    }),
    exam: {
      type: 'object', required: ['timeLimitSec', 'goals'],
      props: {
        timeLimitSec: num(0), checklist: arr(str()),
        goals: arr({
          type: 'object', required: ['weight'],
          props: {
            metric: str(), expect: num(), expectFromParam: str(), tolerance: num(0),
            weight: num(0), minRecords: num(0)
          }
        })
      }
    },
    meta: {
      type: 'object',
      props: {
        dslVersion: str(), version: str(), subject: str(), difficulty: num(1, 3),
        authors: arr(str()), license: str(), tags: arr(str()),
        attribution: arr({
          type: 'object', required: ['project', 'license', 'kind'],
          props: {
            project: str(), license: str(), url: str(), note: str(),
            kind: { type: 'string', enum: ['idea', 'algorithm', 'pedagogy', 'data'] }
          }
        }),
        pedagogy: {
          type: 'object',
          props: { objectives: arr(str()), prerequisites: arr(str()), competencies: arr(str()), estimatedMinutes: num(0) }
        }
      }
    },
    solver: {
      type: 'object', required: ['kind'],
      props: {
        kind: { type: 'string', enum: ['ode', 'analytic', 'circuit', 'monte-carlo'] },
        solver: { type: 'string', enum: ['euler', 'symplectic', 'verlet', 'rk4', 'rk45'] },
        dt: num(1e-9), rtol: num(1e-15, 1), atol: num(1e-15, 1), tEnd: num(0),
        equations: arr(str()), stateNames: arr(str()), paramNames: arr(str()), initial: arr(num()),
        energy: str(), note: str(),
        events: arr({
          type: 'object', required: ['id', 'expression'],
          props: { id: str(), expression: str() }
        })
      }
    },
    analysis: {
      type: 'object',
      props: {
        fit: {
          type: 'object',
          props: {
            model: { type: 'string', enum: ['linear', 'polynomial', 'exponential', 'michaelis', 'power'] },
            xColumn: str(), yColumn: str(), degree: num(1, 8)
          }
        },
        uncertainty: {
          type: 'object', required: ['expression', 'params', 'sigmas'],
          props: { expression: str(), params: arr(str(), 1), sigmas: arr(num(0), 1) }
        },
        spectrum: { type: 'object', props: { column: str(), sampleRate: num(0) } },
        outliers: { type: 'boolean' }
      }
    }
  }
}

const QUIZ_RULE: Rule = {
  type: 'object', required: ['preview', 'review'],
  props: {
    preview: arr({
      type: 'object', required: ['q', 'options', 'answer', 'explain'],
      props: {
        q: str(), options: arr(str(), 2), answer: num(0), explain: str(),
        knowledge: str(), difficulty: num(1, 3)
      }
    }),
    review: arr({
      type: 'object', required: ['q', 'options', 'answer', 'explain'],
      props: {
        q: str(), options: arr(str(), 2), answer: num(0), explain: str(),
        knowledge: str(), difficulty: num(1, 3)
      }
    })
  }
}

function report(issues: ValidationIssue[]): ValidationReport {
  const errors = issues.filter((i) => i.severity === 'error').length
  return { ok: errors === 0, issues, errors, warnings: issues.length - errors }
}

/** 语义校验：结构规则之外的交叉引用、数值区间、表达式与许可证提示 */
export function validateScene(scene: SceneDefV2): ValidationReport {
  const issues = validateValue(scene, SCENE_RULE)
  const warn = (path: string, message: string): void => { issues.push({ path, message, severity: 'warning' }) }
  const error = (path: string, message: string): void => { issues.push({ path, message, severity: 'error' }) }

  const paramIds = new Set((scene.params ?? []).map((p) => p.id))
  const recordIds = new Set((scene.records ?? []).map((r) => r.id))
  ;(scene.params ?? []).forEach((p, i) => {
    if (paramIds.size !== (scene.params ?? []).length) error(`$.params[${i}].id`, '参数 id 重复')
    if (p.min > p.max) error(`$.params[${i}]`, `min(${p.min}) > max(${p.max})`)
    if (p.value < p.min || p.value > p.max) error(`$.params[${i}].value`, `默认值 ${p.value} 超出 [${p.min}, ${p.max}]`)
    if (p.unit && !dimensionOf(p.unit)) warn(`$.params[${i}].unit`, `无法解析单位「${p.unit}」，量纲校验将跳过`)
  })
  ;(scene.records ?? []).forEach((r, i) => {
    if (r.id === undefined || recordIds.size !== (scene.records ?? []).length) error(`$.records[${i}].id`, '记录列 id 重复')
  })
  if (scene.curve) {
    if (!recordIds.has(scene.curve.x)) error('$.curve.x', `引用了不存在的记录列 ${scene.curve.x}`)
    if (!recordIds.has(scene.curve.y)) error('$.curve.y', `引用了不存在的记录列 ${scene.curve.y}`)
  }
  ;(scene.instruments ?? []).forEach((ins, i) => {
    if (ins.recordColumn && !recordIds.has(ins.recordColumn)) error(`$.instruments[${i}].recordColumn`, `引用了不存在的记录列 ${ins.recordColumn}`)
  })
  ;(scene.exam?.goals ?? []).forEach((g, i) => {
    if (!g.metric && g.minRecords === undefined) error(`$.exam.goals[${i}]`, '目标需指定 metric 或 minRecords')
    if (g.expectFromParam && !paramIds.has(g.expectFromParam)) error(`$.exam.goals[${i}].expectFromParam`, `引用了不存在的参数 ${g.expectFromParam}`)
    if ((g.expect !== undefined || g.expectFromParam) && g.tolerance === undefined) warn(`$.exam.goals[${i}]`, '数据精度类目标未设置容差')
  })
  if (scene.solver) {
    for (const [i, eq] of (scene.solver.equations ?? []).entries()) {
      const v = validateExpression(eq)
      if (!v.ok) error(`$.solver.equations[${i}]`, `表达式非法：${v.error}`)
    }
    if (scene.solver.energy) {
      const v = validateExpression(scene.solver.energy)
      if (!v.ok) error('$.solver.energy', `能量表达式非法：${v.error}`)
    }
    ;(scene.solver.events ?? []).forEach((ev, i) => {
      const v = validateExpression(ev.expression)
      if (!v.ok) error(`$.solver.events[${i}].expression`, `事件表达式非法：${v.error}`)
    })
    if (scene.solver.equations && scene.solver.stateNames && scene.solver.equations.length !== scene.solver.stateNames.length) {
      error('$.solver.stateNames', `状态名数量(${scene.solver.stateNames.length}) 与方程数(${scene.solver.equations.length}) 不一致`)
    }
  }
  if (scene.analysis?.uncertainty) {
    const u = scene.analysis.uncertainty
    const v = validateExpression(u.expression)
    if (!v.ok) error('$.analysis.uncertainty.expression', `不确定度表达式非法：${v.error}`)
    if (u.params.length !== u.sigmas.length) error('$.analysis.uncertainty', 'params 与 sigmas 长度不一致')
  }
  if (scene.meta) {
    if (scene.meta.dslVersion !== DSL_VERSION) warn('$.meta.dslVersion', `声明为 ${scene.meta.dslVersion}，当前内核为 ${DSL_VERSION}`)
    if (scene.meta.license && !KNOWN_SPDX.has(scene.meta.license)) warn('$.meta.license', `非常见 SPDX 标识 ${scene.meta.license}`)
    if (!scene.meta.license || scene.meta.license === 'NOASSERTION') warn('$.meta.license', '未声明实验包许可证，公开发布前需确认权利归属')
    ;(scene.meta.attribution ?? []).forEach((a, i) => {
      if (!KNOWN_SPDX.has(a.license)) warn(`$.meta.attribution[${i}].license`, `非常见 SPDX 标识 ${a.license}`)
    })
  } else {
    warn('$.meta', '缺少 V3 元数据（许可证 / 思想来源 / 教学目标）')
  }
  return report(issues)
}

export function validateQuiz(quiz: QuizDef): ValidationReport {
  const issues = validateValue(quiz, QUIZ_RULE)
  for (const phase of ['preview', 'review'] as const) {
    ;(quiz[phase] ?? []).forEach((q, i) => {
      if (q.options && q.answer >= q.options.length) {
        issues.push({ path: `$.${phase}[${i}].answer`, message: `答案下标 ${q.answer} 超出选项数 ${q.options.length}`, severity: 'error' })
      }
    })
  }
  return report(issues)
}

export function validatePackage(pkg: ExperimentPackage): ValidationReport {
  const issues = [...validateScene(pkg.scene).issues]
  if (pkg.quiz) issues.push(...validateQuiz(pkg.quiz).issues)
  return report(issues)
}

export function formatIssues(r: ValidationReport, limit = 20): string {
  const lines = r.issues.slice(0, limit).map((i) => `[${i.severity === 'error' ? '错误' : '提示'}] ${i.path}: ${i.message}`)
  if (r.issues.length > limit) lines.push(`… 另有 ${r.issues.length - limit} 条`)
  return lines.join('\n')
}
