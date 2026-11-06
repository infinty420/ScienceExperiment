import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labDB, ensureDefaultProfile, activeProfileId, setActiveProfile } from '../src/learning/db'
import {
  bktUpdate, initialMemory, retrievability, nextReviewAt, scheduleReview,
  newMastery, updateMastery, masteryPercent, dueKnowledge, masterySummary, DAY
} from '../src/learning/mastery'
import { makeCard, reviewMistake, dueMistakes, mistakeStats, collectMistakes } from '../src/learning/mistakes'
import { recommendNext, buildStudyPlan, knowledgeKey } from '../src/learning/recommend'
import { createSnapshot, verifySnapshot, serializeSnapshot, parseSnapshot, replaySnapshot, compareSnapshots, SNAPSHOT_SCHEMA } from '../src/learning/snapshot'
import { buildReport } from '../src/report/builder'
import { toMarkdown, toHTML, toCSV, svgLineChart, exportReport } from '../src/report/export'
import { tokenize, buildIndex, search } from '../src/assistant/retrieval'
import { renderLatex, FORMULA_LIBRARY, findFormula } from '../src/assistant/formula'
import { AssistantEngine, diagnoseRows } from '../src/assistant/engine'
import { integrate } from '../src/kernel/ode'
import { compileSystem } from '../src/kernel/expr'

const T0 = 1_700_000_000_000
const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} 失败`)

test('持久层：写入/读取/删除/档案切换（无 IndexedDB 时内存降级）', async () => {
  const engine = await labDB.init()
  assert.ok(engine === 'indexeddb' || engine === 'memory')
  await labDB.put('runs', { id: 'test.run.1', experimentId: 'physics.pendulum', score: 88 })
  const row = await labDB.get<{ id: string; score: number }>('runs', 'test.run.1')
  assert.equal(row?.score, 88)
  const all = await labDB.getAll<{ id: string }>('runs')
  assert.ok(all.some((r) => r.id === 'test.run.1'))
  const p = await ensureDefaultProfile()
  assert.equal(p.id, 'profile.default')
  await setActiveProfile('profile.test')
  assert.equal(await activeProfileId(), 'profile.test')
  await setActiveProfile('profile.default')
  await labDB.delete('runs', 'test.run.1')
  assert.equal(await labDB.get('runs', 'test.run.1'), undefined)
})

test('BKT：连续答对提升掌握概率，答错下降', () => {
  let p = 0.25
  for (let i = 0; i < 8; i++) p = bktUpdate(p, true)
  assert.ok(p > 0.9, `p=${p}`)
  const q = bktUpdate(p, false)
  assert.ok(q < p)
  assert.ok(q < 1 && q > 0)
})

test('记忆 D/S/R：遗忘衰减、复习后稳定性增长、到期判定', () => {
  const m0 = initialMemory(5, T0)
  close(retrievability(m0, T0), 1)
  const later = T0 + 10 * DAY
  assert.ok(retrievability(m0, later) < 0.5)
  const m1 = scheduleReview(m0, 5, T0)
  assert.ok(m1.stability > m0.stability)
  assert.equal(m1.repetitions, 1)
  const m2 = scheduleReview(m0, 1, T0)
  assert.ok(m2.stability < m0.stability)
  assert.equal(m2.lapses, 1)
  const due = nextReviewAt(m0, 0.9)
  assert.ok(due > T0 && due < T0 + 2 * DAY)
})

test('掌握度记录与到期队列', () => {
  let rec = newMastery(knowledgeKey('physics.pendulum'), T0)
  rec = updateMastery(rec, true, T0)
  assert.ok(rec.pKnown > 0.25)
  assert.equal(rec.attempts, 1)
  assert.equal(rec.correct, 1)
  const stale = { ...rec, memory: { ...rec.memory, lastReview: T0 - 100 * DAY } }
  const due = dueKnowledge([rec, stale], T0 + 1)
  assert.ok(due.some((r) => r.knowledgeKey === stale.knowledgeKey))
  const summary = masterySummary([rec, stale], T0 + 1)
  assert.equal(summary.count, 2)
  assert.ok(summary.due >= 1)
  assert.ok(masteryPercent(rec, T0) > 0)
})

test('错题本：复习、连对毕业、去重收集', () => {
  let card = makeCard({
    experimentId: 'physics.pendulum', question: '单摆周期与什么有关？',
    options: ['摆长', '质量', '颜色'], answer: 0, chosen: 1, explain: 'T=2π√(L/g)'
  }, T0)
  assert.equal(card.graduated, false)
  card = reviewMistake(card, false, T0 + DAY)
  assert.equal(card.lapses, 1)
  assert.equal(card.streak, 0)
  for (let i = 1; i <= 3; i++) card = reviewMistake(card, true, T0 + (i + 1) * DAY)
  assert.equal(card.streak, 3)
  assert.equal(card.graduated, true)
  const due = dueMistakes([card, makeCard({ experimentId: 'x', question: 'q2', options: ['a', 'b'], answer: 0, chosen: 1, explain: 'e' }, T0 - 10 * DAY)], T0 + 5 * DAY)
  assert.ok(due.some((c) => c.question === 'q2'))
  const stats = mistakeStats([card], T0 + 5 * DAY)
  assert.equal(stats.graduated, 1)
  const collected = collectMistakes([
    { q: 'A', options: ['1', '2'], answer: 0, chosen: 1, explain: 'x' },
    { q: 'A', options: ['1', '2'], answer: 0, chosen: 1, explain: 'x' },
    { q: 'B', options: ['1', '2'], answer: 0, chosen: 0, explain: 'x' }
  ], 'e1', [], T0)
  assert.equal(collected.length, 1, '同题去重且正确题不入本')
})

test('推荐器：薄弱实验、到期复习、新实验优先级', () => {
  const ids = ['physics.pendulum', 'physics.shm', 'physics.lens']
  const progress = {
    'physics.pendulum': { preview: 80, done: true, review: 40 },
    'physics.shm': { preview: 90, done: true, review: 95 },
    'physics.lens': { preview: null, done: false, review: null }
  }
  const rec = { ...newMastery(knowledgeKey('physics.pendulum'), T0 - 200 * DAY), pKnown: 0.4 }
  const plan = buildStudyPlan({ experimentIds: ids, progress, mastery: [rec], mistakes: [], now: T0 })
  assert.ok(plan.items.length >= 2)
  assert.ok(plan.items[0].kind === 'review' || plan.items[0].kind === 'weak')
  assert.ok(plan.overallProgress > 0)
  const list = recommendNext({ experimentIds: ids, progress, mastery: [rec], mistakes: [], now: T0 })
  assert.ok(list.every((r) => ids.includes(r.experimentId)))
  assert.match(list.map((r) => r.reason).join(''), /记忆|薄弱|尚未/)
})

test('可复现快照：校验和、篡改检测、序列化往返、数值复跑', () => {
  const solver = {
    kind: 'ode' as const, solver: 'rk4' as const, dt: 0.05, tEnd: 1,
    equations: ['v', '-k*x'], stateNames: ['x', 'v'], paramNames: ['k'], initial: [1, 0]
  }
  const sys = compileSystem(solver.equations, solver.stateNames!, solver.paramNames!)
  const traj = integrate((t, y) => sys.derivative(t, y, { k: 4 }), [1, 0], 0, 1, { solver: 'rk4', dt: 0.05 })
  const rows = traj.points.map((p) => [p.t, p.y[0], p.y[1]])
  const snap = createSnapshot({ experimentId: 'custom.osc', title: '阻尼振子', params: { k: 4 }, rows, solver, seed: 42 })
  assert.equal(snap.schema, SNAPSHOT_SCHEMA)
  assert.equal(snap.checksum.length, 64)
  assert.equal(verifySnapshot(snap), true)
  const parsed = parseSnapshot(serializeSnapshot(snap))
  assert.equal(parsed.ok, true, parsed.error)
  assert.equal(parsed.snapshot!.checksum, snap.checksum)
  const tampered = { ...snap, rows: rows.map((r) => r.map((v) => v + 1)) }
  assert.equal(verifySnapshot(tampered), false)
  assert.equal(parseSnapshot(JSON.stringify({ format: SNAPSHOT_SCHEMA, snapshot: tampered })).ok, false)
  const replay = replaySnapshot(snap)
  assert.equal(replay.ok, true)
  assert.equal(replay.matches, true, `maxDiff=${replay.maxAbsDiff}`)
  assert.ok(replay.diagnostics!.steps > 0)
  const other = createSnapshot({ experimentId: 'custom.osc', title: '阻尼振子', params: { k: 8 }, rows, solver, seed: 42 })
  const diff = compareSnapshots(snap, other)
  assert.deepEqual(diff.changedParams, ['k'])
  assert.equal(diff.sameChecksum, false)
})

test('报告 3.0：结构化章节、Markdown/HTML/CSV/SVG', () => {
  const rows = [[0, 1], [1, 3], [2, 5], [3, 7], [4, 9]]
  const r = buildReport({
    experimentId: 'physics.ohm_law', title: '欧姆定律验证',
    params: { R: 20 }, paramLabels: { R: '电阻' }, rows, headers: ['U', 'I'],
    guide: '验证 U 与 I 成正比', resultLines: ['拟合斜率 2.0'],
    attribution: [{ project: 'Kunz5/circuit-lab', license: 'MIT', kind: 'algorithm', note: 'MNA 思路' }]
  })
  assert.equal(r.version, '3.0')
  assert.ok(r.sections.some((s) => s.key === 'attribution'))
  assert.ok(r.sections.find((s) => s.key === 'data')!.table!.rows.length === 5)
  const md = toMarkdown(r)
  assert.match(md, /实验报告 3.0/)
  assert.match(md, /数据处理与分析/)
  const html = toHTML(r)
  assert.match(html, /<!DOCTYPE html>/)
  assert.match(html, /<svg/)
  assert.match(html, /参考与致谢/)
  assert.match(exportReport(r, 'markdown'), /# 欧姆定律验证/)
  const csv = toCSV(rows, ['U', 'I'])
  assert.ok(csv.startsWith('\ufeff'))
  assert.match(csv, /U,I/)
  assert.match(svgLineChart(rows, 0, 1), /<polyline/)
  assert.match(svgLineChart([[1]], 0, 1), /数据点不足/)
})

test('BM25 检索：中文二元字与英文词元', () => {
  const toks = tokenize('单摆周期 Pendulum 9.8')
  assert.ok(toks.includes('单摆'))
  assert.ok(toks.includes('pendulum'))
  const index = buildIndex([
    { id: 'a', title: '单摆测重力加速度', body: '通过测量周期 T 与摆长 L 计算重力加速度 g = 4π²L/T²', tags: ['力学'] },
    { id: 'b', title: '欧姆定律验证', body: '测量电压与电流的关系，拟合 I–U 直线求电阻', tags: ['电学'] }
  ])
  const hits = search(index, '单摆 周期 重力加速度', 2)
  assert.ok(hits.length >= 1)
  assert.equal(hits[0].doc.id, 'a')
})

test('LaTeX 子集渲染与公式库', () => {
  assert.ok(FORMULA_LIBRARY.length >= 8)
  const html = renderLatex('T = 2\\pi\\sqrt{\\frac{L}{g}}')
  assert.match(html, /π/)
  assert.match(html, /frac/)
  assert.match(html, /sqrt/)
  assert.match(renderLatex('x^2 + y_1'), /<sup>2<\/sup>/)
  assert.match(renderLatex('x^2 + y_1'), /<sub>1<\/sub>/)
  assert.equal(findFormula('单摆周期')!.id, 'pendulum')
  assert.match(renderLatex('<script>'), /&lt;script&gt;/, '必须转义 HTML')
})

test('助教引擎：离线检索、数据诊断与适配器回退', async () => {
  const docs = [{ id: 'physics.pendulum', title: '单摆测重力加速度', body: '小角度下单摆周期 T = 2π√(L/g)，通过测量周期与摆长可求得重力加速度。', tags: ['力学'] }]
  const engine = new AssistantEngine(docs)
  const ans = engine.ask('单摆周期怎么算', { rows: [[1, 2], [2, 4], [3, 6], [4, 8], [5, 10]] })
  assert.equal(ans.mode, 'offline')
  assert.ok(ans.sources.length >= 1)
  assert.match(ans.text, /单摆|重力加速度/)
  assert.ok(ans.diagnostics.length > 0)
  const diag = diagnoseRows([[1, 2], [1, 2], [1, 2]])
  assert.match(diag.join(''), /几乎没有变化|补测/)
  engine.setAdapter({ ask: async () => '模型回答：应使用 T = 2π√(L/g)' })
  const llm = await engine.askAsync('单摆周期', {})
  assert.equal(llm.mode, 'llm')
  assert.match(llm.text, /模型回答/)
  engine.setAdapter({ ask: async () => { throw new Error('offline') } })
  const fallback = await engine.askAsync('单摆周期', {})
  assert.equal(fallback.mode, 'offline')
  assert.match(fallback.text!, /回退/)
})
