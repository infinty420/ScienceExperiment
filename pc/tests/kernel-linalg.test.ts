import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  luDecompose, luSolve, solveLinear, invert, determinant, conditionNumber,
  matMul, matVec, transpose, identity, cholesky, choleskySolve, solveNormalEquations, matrixNorm1
} from '../src/kernel/linalg'

const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} 失败`)

test('LU 分解与求解：3x3 线性方程组', () => {
  const A = [[2, 1, -1], [-3, -1, 2], [-2, 1, 2]]
  const b = [8, -11, -3]
  const x = solveLinear(A, b)
  assert.deepEqual(x.map((v) => Math.round(v)), [2, 3, -1])
  const res = luDecompose(A)
  assert.equal(res.singular, false)
  const y = luSolve(res, b)
  y.forEach((v, i) => close(v, x[i]))
})

test('行列式 / 逆矩阵 / 条件数', () => {
  const A = [[4, 1], [1, 3]]
  close(determinant(A), 11, 1e-9)
  const inv = invert(A)
  const prod = matMul(A, inv)
  close(prod[0][0], 1); close(prod[1][1], 1); close(prod[0][1], 0)
  assert.ok(conditionNumber(identity(3)) >= 1)
  assert.ok(Number.isFinite(conditionNumber(A)))
  assert.equal(matrixNorm1(identity(4)), 1)
})

test('奇异矩阵检测：零列', () => {
  const res = luDecompose([[0, 1], [0, 2]])
  assert.equal(res.singular, true)
})

test('Cholesky 解对称正定系统', () => {
  const A = [[4, 1], [1, 3]]
  const l = cholesky(A)
  const x = choleskySolve(l, [1, 2])
  const expected = solveLinear(A, [1, 2])
  x.forEach((v, i) => close(v, expected[i], 1e-10))
})

test('加权正规方程：无权重退化为普通最小二乘', () => {
  const A = [[1, 0], [1, 1], [1, 2], [1, 3]]
  const y = [1, 3, 5, 7]
  const { params, cov } = solveNormalEquations(A, y)
  close(params[0], 1, 1e-8)
  close(params[1], 2, 1e-8)
  assert.equal(cov.length, 2)
})

test('矩阵转置与矩阵向量乘', () => {
  const A = [[1, 2, 3], [4, 5, 6]]
  assert.deepEqual(transpose(A), [[1, 4], [2, 5], [3, 6]])
  assert.deepEqual(matVec(A, [1, 1, 1]), [6, 15])
})
