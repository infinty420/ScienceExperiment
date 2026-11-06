import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validateScene, validateQuiz, validatePackage, formatIssues } from '../src/experiments/validate'
import { registerPackage, getPackage, exportPackage, unregisterPackage, packageStats, migrateToV2, registerBuiltin } from '../src/experiments/packages'
import { sha256Hex, hashObject, shortHash } from '../src/report/hash'
import type { SceneDefV2 } from '../src/experiments/schema'

const experimentsDir = resolve(process.cwd(), 'experiments')
const dirs = readdirSync(experimentsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
const readScene = (dir: string): SceneDefV2 => JSON.parse(readFileSync(join(experimentsDir, dir, 'scene.json'), 'utf8'))

test('全部内置实验包通过 DSL v2 结构校验（零 error）', () => {
  assert.ok(dirs.length >= 27, `实验包数量 ${dirs.length}`)
  const problems: string[] = []
  let warnings = 0
  for (const dir of dirs) {
    const r = validateScene(readScene(dir))
    warnings += r.warnings
    if (!r.ok) problems.push(`${dir}:\n${formatIssues(r, 6)}`)
  }
  assert.equal(problems.length, 0, problems.join('\n---\n'))
  console.log(`[dsl] ${dirs.length} 个实验包校验通过，${warnings} 条提示`)
})

test('全部内置实验包含 V3 元数据与许可证声明', () => {
  for (const dir of dirs) {
    const scene = readScene(dir)
    assert.equal(scene.meta?.dslVersion, '2.0.0', `${dir} 缺少 dslVersion`)
    assert.ok(scene.meta?.license, `${dir} 缺少 license`)
    assert.ok(Array.isArray(scene.meta?.attribution) && scene.meta!.attribution!.length > 0, `${dir} 缺少来源声明`)
  }
  const specialized = dirs.filter((d) => readScene(d).solver || readScene(d).analysis)
  assert.ok(specialized.length >= 6, `专项声明实验数 ${specialized.length}`)
})

test('题库结构校验与答案下标越界检测', () => {
  const quizzes = dirs.filter((d) => {
    try { readFileSync(join(experimentsDir, d, 'quiz.json'), 'utf8'); return true } catch { return false }
  })
  assert.ok(quizzes.length >= 8)
  for (const d of quizzes) {
    const quiz = JSON.parse(readFileSync(join(experimentsDir, d, 'quiz.json'), 'utf8'))
    const r = validateQuiz(quiz)
    assert.equal(r.errors, 0, `${d}: ${formatIssues(r)}`)
  }
  const bad = validateQuiz({
    preview: [{ q: '题目', options: ['A', 'B'], answer: 5, explain: '解析' }],
    review: []
  })
  assert.equal(bad.ok, false)
  assert.match(formatIssues(bad), /答案下标/)
})

test('校验器能定位交叉引用错误', () => {
  const scene = readScene('physics.pendulum')
  scene.curve = { x: 'not_exist', y: 'T', title: 'x' }
  scene.params[0].value = 999
  const r = validateScene(scene)
  assert.equal(r.ok, false)
  const text = formatIssues(r)
  assert.match(text, /不存在的记录列/)
  assert.match(text, /超出/)
})

test('非法 solver 表达式会被拦截', () => {
  const scene = readScene('physics.pendulum')
  scene.solver!.equations = ['omega', 'sin(']
  const r = validateScene(scene)
  assert.equal(r.ok, false)
  assert.match(formatIssues(r), /表达式非法/)
})

test('导入外部实验包：迁移 → 校验 → 注册 → 导出 → 卸载', () => {
  const custom = {
    id: 'custom.damped_oscillator',
    title: '导入实验：阻尼振子',
    camera: { position: [0, 2, 6], target: [0, 1, 0] },
    objects: [{ id: 'ball', type: 'sphere', position: [0, 1, 0], size: [0.2] }],
    params: [{ id: 'k', label: '劲度系数', min: 1, max: 50, step: 1, value: 10, unit: 'N/m' }],
    records: [{ id: 't', label: 't (s)', digits: 3 }, { id: 'x', label: 'x (m)', digits: 4 }],
    guide: '自定义数值实验',
    meta: { dslVersion: '2.0.0', license: 'MIT', attribution: [] },
    solver: {
      kind: 'ode', solver: 'rk4', dt: 0.01, tEnd: 2,
      equations: ['v', '-k*x - 0.2*v'], stateNames: ['x', 'v'], initial: [1, 0]
    }
  }
  const res = registerPackage(JSON.stringify(custom))
  assert.equal(res.ok, true, formatIssues(res.report))
  assert.equal(res.id, 'custom.damped_oscillator')
  assert.equal(getPackage(res.id)!.source, 'imported')
  assert.equal(getPackage(res.id)!.scene.meta!.dslVersion, '2.0.0')
  const exported = exportPackage(res.id)!
  assert.match(exported, /scilab.experiment.v2/)
  const reimport = registerPackage(exported)
  assert.equal(reimport.ok, true)
  assert.equal(unregisterPackage(res.id), true)
  assert.equal(getPackage(res.id), undefined)
})

test('残缺实验包被拒绝且给出字段路径', () => {
  const res = registerPackage({ id: 'bad.x' })
  assert.equal(res.ok, false)
  const text = formatIssues(res.report)
  assert.match(text, /缺少必填字段|应为/)
  assert.equal(getPackage('bad.x'), undefined)
})

test('V1 包迁移：补齐 dslVersion 且生成稳定校验和', () => {
  const v1 = readScene('physics.pendulum')
  delete v1.meta // 模拟 V1：完全没有元数据
  const a = migrateToV2(v1, 'builtin')
  const b = migrateToV2(v1, 'builtin')
  assert.equal(a.scene.meta!.dslVersion, '2.0.0')
  assert.equal(a.scene.meta!.license, undefined, '迁移不臆造许可证')
  assert.equal(a.checksum, b.checksum)
  assert.equal(v1.meta, undefined, '迁移不得修改原对象')
})

test('SHA-256：标准测试向量与稳定对象哈希', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(hashObject({ b: 1, a: 2 }), hashObject({ a: 2, b: 1 }))
  assert.equal(shortHash('abc', 8), 'ba7816bf')
  assert.equal(sha256Hex('中文😀').length, 64)
})

test('包统计：批量注册内置包后分类与校验结果正确', () => {
  for (const dir of dirs) registerBuiltin(readScene(dir))
  const stats = packageStats()
  assert.ok(stats.builtin >= 27, `builtin=${stats.builtin}`)
  assert.equal(stats.errors, 0, '内置包应零结构错误')
  assert.equal(stats.total, stats.builtin + stats.imported)
})
