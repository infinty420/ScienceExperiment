#!/usr/bin/env node
/**
 * 独立实验包体检（零依赖，Node >= 18），可在无构建环境时单独运行。
 *
 * 用法：
 *   node package_check.mjs --dir ./experiments
 *   node package_check.mjs --dir ./experiments --strict   # 有警告也失败
 *
 * 校验内容：
 *   - 每个实验包目录必须有 scene.json，字段 id / title / records / params 合法
 *   - DSL v2 的 meta.dslVersion、meta.license、meta.attribution 可追溯
 *   - solver.equations / energy / events 表达式不含注入面（eval、Function、require 等）
 *   - quiz.json 的每题 answer 下标不得越界，选项不得为空
 *   - 输出错误 / 警告清单，错误非零时以退出码 1 结束（供 CI 使用）
 *
 * 注意：本脚本只做结构与安全校验，不执行任何包内表达式。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const root = resolve(args.dir ?? './experiments')
const strict = args.strict === 'true' || args.strict === true

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      out[key] = next && !next.startsWith('--') ? next : 'true'
      if (out[key] === next) i++
    }
  }
  return out
}

const FORBIDDEN_PATTERNS = [
  [/\beval\b/, 'eval'],
  [/\bnew\s+Function\b/, 'new Function'],
  [/\brequire\s*\(/, 'require()'],
  [/\bimport\s*\(/, 'import()'],
  [/\bprocess\./, 'process.*'],
  [/\bglobalThis\b/, 'globalThis'],
  [/__proto__/, '__proto__'],
  [/\bconstructor\s*\(/, 'constructor()'],
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bdocument\./, 'document.*'],
  [/\bwindow\./, 'window.*']
]
const KNOWN_SOLVERS = new Set(['ode', 'analytic', 'circuit', 'monte-carlo'])
const KNOWN_METHODS = new Set(['euler', 'symplectic', 'verlet', 'rk4', 'rk45'])

if (!existsSync(root)) {
  console.error(`[packages] 目录不存在: ${root}`)
  process.exit(1)
}

const dirs = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

const issues = []
function error(id, path, msg) { issues.push({ level: 'error', id, path, msg }) }
function warn(id, path, msg) { issues.push({ level: 'warn', id, path, msg }) }
function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

function checkExpressions(id, spec) {
  const exprs = []
  if (Array.isArray(spec.equations)) exprs.push(...spec.equations.map((e, i) => [`equations[${i}]`, e]))
  if (typeof spec.energy === 'string') exprs.push(['energy', spec.energy])
  if (Array.isArray(spec.events)) {
    for (const [i, ev] of spec.events.entries()) {
      if (!ev || typeof ev.expression !== 'string') error(id, `solver.events[${i}]`, '事件缺少 expression')
      else exprs.push([`events[${i}].expression`, ev.expression])
    }
  }
  for (const [path, text] of exprs) {
    if (typeof text !== 'string' || !text.trim()) {
      error(id, `solver.${path}`, '表达式必须为非空字符串')
      continue
    }
    const hit = FORBIDDEN_PATTERNS.find(([re]) => re.test(text))
    if (hit) error(id, `solver.${path}`, `含禁用构造 ${hit[1]}（注入面）: ${text.slice(0, 60)}`)
    if (/[;{}]/.test(text)) warn(id, `solver.${path}`, '含分号或花括号，建议只写纯数学表达式')
  }
}

function checkScene(id, raw) {
  let scene
  try { scene = JSON.parse(raw) } catch (e) {
    error(id, 'scene.json', `JSON 解析失败: ${e.message}`)
    return
  }
  if (!isObject(scene)) { error(id, 'scene.json', '根节点必须是对象'); return }
  if (typeof scene.id !== 'string' || !scene.id) error(id, 'id', '缺少非空 id')
  else if (scene.id !== id) warn(id, 'id', `包内 id (${scene.id}) 与目录名 (${id}) 不一致`)
  if (typeof scene.title !== 'string' || !scene.title) error(id, 'title', '缺少非空 title')
  if ('records' in scene && !Array.isArray(scene.records)) error(id, 'records', '必须是数组（定性观察类允许为空数组）')
  if ('params' in scene && !Array.isArray(scene.params)) error(id, 'params', '必须是数组')

  const meta = scene.meta
  if (!isObject(meta)) {
    warn(id, 'meta', '缺少 DSL v2 元数据（建议补齐版本、许可证与思想来源）')
  } else {
    if (typeof meta.dslVersion !== 'string') error(id, 'meta.dslVersion', '缺少 DSL 版本号')
    if (typeof meta.license !== 'string' || !meta.license) {
      error(id, 'meta.license', '缺少许可证声明；来源不明不得入库')
    }
    if (meta.attribution !== undefined && !Array.isArray(meta.attribution)) {
      error(id, 'meta.attribution', '思想来源必须是数组')
    }
    if (!meta.attribution) warn(id, 'meta.attribution', '未声明思想来源，合规报告无法追溯')
  }

  if (scene.solver !== undefined) {
    const s = scene.solver
    if (!isObject(s)) error(id, 'solver', '必须是对象')
    else {
      if (!KNOWN_SOLVERS.has(s.kind)) error(id, 'solver.kind', `未知类型: ${s.kind}`)
      if (s.solver !== undefined && !KNOWN_METHODS.has(s.solver)) error(id, 'solver.solver', `未知数值方法: ${s.solver}`)
      if (s.kind === 'ode') {
        if (!Array.isArray(s.equations) || !s.equations.length) error(id, 'solver.equations', 'ODE 类型必须声明方程右端')
        if (!Array.isArray(s.stateNames) || !s.stateNames.length) error(id, 'solver.stateNames', '必须声明状态变量名')
        if (Array.isArray(s.equations) && Array.isArray(s.stateNames) && s.equations.length !== s.stateNames.length) {
          error(id, 'solver.equations', '方程数量与状态变量数量必须一致')
        }
      }
      checkExpressions(id, s)
    }
  }
}

// 兼容三种常见题库组织方式：
//   1) 顶层数组
//   2) { questions: [...] }
//   3) 分组对象 { preview: [...], review: [...] }（教学场景常见：预习题 / 复习题）
function questionGroups(quiz) {
  if (Array.isArray(quiz)) return [['', quiz]]
  if (!isObject(quiz)) return null
  if (Array.isArray(quiz.questions)) return [['questions', quiz.questions]]
  const groups = Object.entries(quiz).filter(([, v]) => Array.isArray(v))
  const valid = groups.some(([, list]) => list.length === 0 || list.every(
    (q) => isObject(q) && (typeof q.q === 'string' || typeof q.question === 'string') && Array.isArray(q.options)
  ))
  return valid ? groups : null
}

function checkQuiz(id, raw) {
  let quiz
  try { quiz = JSON.parse(raw) } catch (e) {
    error(id, 'quiz.json', `JSON 解析失败: ${e.message}`)
    return
  }
  const groups = questionGroups(quiz)
  if (!groups) { error(id, 'quiz.json', '必须是题目数组、含 questions 数组的对象，或分组题目对象'); return }
  for (const [group, list] of groups) {
    const prefix = group ? `quiz.${group}` : 'quiz'
    list.forEach((q, i) => {
      if (!isObject(q)) { error(id, `${prefix}[${i}]`, '必须是对象'); return }
      if (typeof q.q !== 'string' && typeof q.question !== 'string') error(id, `${prefix}[${i}].q`, '缺少题干')
      if (!Array.isArray(q.options) || q.options.length < 2) error(id, `${prefix}[${i}].options`, '选项至少 2 个')
      if (!Number.isInteger(q.answer)) error(id, `${prefix}[${i}].answer`, 'answer 必须是整数下标')
      else if (Array.isArray(q.options) && (q.answer < 0 || q.answer >= q.options.length)) {
        error(id, `${prefix}[${i}].answer`, `答案下标 ${q.answer} 越界（选项 ${q.options.length} 个）`)
      }
    })
  }
}

let quizzes = 0
for (const id of dirs) {
  const scenePath = join(root, id, 'scene.json')
  if (!existsSync(scenePath)) { error(id, 'scene.json', '实验包缺少 scene.json'); continue }
  checkScene(id, readFileSync(scenePath, 'utf8'))
  const quizPath = join(root, id, 'quiz.json')
  if (existsSync(quizPath)) { quizzes++; checkQuiz(id, readFileSync(quizPath, 'utf8')) }
}

const errors = issues.filter((i) => i.level === 'error')
const warnings = issues.filter((i) => i.level === 'warn')
for (const i of issues) {
  console.log(`[${i.level === 'error' ? 'ERROR' : 'WARN '}] ${i.id}/${i.path}: ${i.msg}`)
}
console.log(`[packages] ${dirs.length} 个实验包 + ${quizzes} 个题库：${errors.length} 个错误，${warnings.length} 条提示`)
process.exit(errors.length || (strict && warnings.length) ? 1 : 0)
