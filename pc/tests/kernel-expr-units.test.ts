import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, compile, validateExpression, compileSystem, parseExpression } from '../src/kernel/expr'
import { convert, dimensionOf, sameDimension, checkDimensions, formatDimension, toSI } from '../src/kernel/units'
import { RNG, hashSeed, stableStringify } from '../src/kernel/rng'

const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} 失败`)

test('表达式：优先级、右结合幂、一元负号', () => {
  close(evaluate('2 + 3 * 4'), 14)
  close(evaluate('(2 + 3) * 4'), 20)
  close(evaluate('2^3^2'), 512)
  close(evaluate('-2^2'), -4)
  close(evaluate('1e-3 * 1000'), 1)
  close(evaluate('sin(pi/2) + cos(0)'), 2)
  close(evaluate('max(1, 5, 3) + min(2, 4)'), 7)
  close(evaluate('clamp(12, 0, 10)'), 10)
})

test('表达式：变量、常量、缺值返回 NaN', () => {
  const c = compile('g * t^2 / 2 + v0 * t')
  assert.deepEqual(c.variables.sort(), ['t', 'v0'])
  close(c.evaluate({ t: 2, v0: 3 }), 9.80665 * 2 + 6)
  assert.ok(Number.isNaN(c.evaluate({ t: 1 })))
  close(evaluate('R * T / (n * F)', { R: 8.314, T: 300, n: 2, F: 96485 }), 8.314 * 300 / (2 * 96485))
})

test('表达式：拒绝非法输入与未知函数（不使用 eval）', () => {
  assert.equal(validateExpression('1 + * 2').ok, false)
  assert.equal(validateExpression('evil(1)').ok, false)
  assert.equal(validateExpression('2 + (3').ok, false)
  assert.equal(validateExpression('constructor').ok, true) // 只是变量名，不会执行
  assert.ok(Number.isNaN(evaluate('constructor')))
  assert.equal(parseExpression('a+b').type, 'bin')
})

test('表达式：编译成 ODE 右端函数', () => {
  const sys = compileSystem(['v', '-g/L * sin(theta) - c * v'], ['theta', 'v'], ['g', 'L', 'c'])
  const d = sys.derivative(0, [0.5, 0.2], { g: 9.8, L: 2, c: 0.1 })
  assert.equal(d.length, 2)
  close(d[0], 0.2)
  close(d[1], -(9.8 / 2) * Math.sin(0.5) - 0.1 * 0.2)
})

test('单位换算与量纲向量', () => {
  close(convert(100, 'cm', 'm'), 1)
  close(convert(1, 'km', 'm'), 1000)
  close(convert(0, 'degC', 'K'), 273.15)
  close(toSI(1, 'kohm'), 1000)
  const n = dimensionOf('N')!
  const kgms2 = dimensionOf('kg*m/s^2')!
  assert.ok(sameDimension(n, kgms2))
  assert.ok(!sameDimension(dimensionOf('m')!, dimensionOf('s')!))
  assert.equal(formatDimension(dimensionOf('J')!), 'm^2·kg·s^-2')
})

test('批量量纲校验：正确与错误都能定位', () => {
  const checks = checkDimensions([
    { expr: 'm/s^2', expect: 'N/kg' },
    { expr: 'V/A', expect: 'ohm' },
    { expr: 'm', expect: 's' }
  ])
  assert.equal(checks[0].ok, true)
  assert.equal(checks[1].ok, true)
  assert.equal(checks[2].ok, false)
  assert.match(checks[2].reason!, /量纲不匹配/)
  assert.throws(() => convert(1, 'm', 's'))
})

test('随机数：同种子可复现，正态均值收敛', () => {
  const a = new RNG('snapshot-42')
  const b = new RNG('snapshot-42')
  const c = new RNG('other')
  for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next())
  assert.notEqual(a.next(), c.next())
  assert.equal(hashSeed('abc'), hashSeed('abc'))
  const r = new RNG(7)
  const xs: number[] = []
  for (let i = 0; i < 20000; i++) xs.push(r.normal(5, 2))
  const m = xs.reduce((s, v) => s + v, 0) / xs.length
  assert.ok(Math.abs(m - 5) < 0.1)
  assert.equal(new RNG(1).fork('x').seed, new RNG(1).fork('x').seed)
})

test('稳定序列化：键顺序无关', () => {
  assert.equal(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }), stableStringify({ a: [2, { c: 4, d: 3 }], b: 1 }))
})
