import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linearFit, polynomialFit, nonlinearFit, describeFit, studentT95 } from '../src/kernel/fit'
import {
  mean, variance, stdev, median, quantile, covariance, pearsonCorrelation,
  outliersIQR, grubbsTest, propagateUncertainty, monteCarloUncertainty,
  fft, powerSpectrum, dominantFrequency, welchTTest, regularizedBeta, detrend, nextPowerOfTwo
} from '../src/kernel/stats'

const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} 失败`)

test('线性拟合：参数、R²、置信区间、AIC', () => {
  const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  const y = x.map((v) => 2 + 3 * v)
  const f = linearFit(x, y)
  close(f.params[0], 2, 1e-8)
  close(f.params[1], 3, 1e-8)
  close(f.r2, 1, 1e-10)
  close(f.predict(10), 32, 1e-8)
  assert.equal(f.n, 10)
  assert.equal(f.k, 2)
  // 无噪声的完美拟合：置信区间退化为点估计
  close(f.ci95[1][0], 3, 1e-6)
  close(f.ci95[1][1], 3, 1e-6)
  assert.ok(Number.isFinite(f.aic))
  assert.match(describeFit(f, ['截距', '斜率']), /R²/)
})

test('带噪声线性拟合：置信区间覆盖真值', () => {
  const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  const noise = [0.4, -0.3, 0.2, 0.5, -0.4, 0.1, -0.2, 0.3, -0.1, 0.2]
  const f = linearFit(x, x.map((v, i) => 2 + 3 * v + noise[i]))
  assert.ok(f.r2 > 0.998)
  assert.ok(f.ci95[1][0] < 3 && f.ci95[1][1] > 3, '斜率 95% CI 应覆盖真值 3')
  assert.ok(f.stdErrors[1] > 0 && f.rmse > 0)
})

test('加权线性拟合：高权重样本主导', () => {
  const x = [0, 1, 2, 3]
  const y = [0, 1, 2, 100]
  const w = [100, 100, 100, 1]
  const f = linearFit(x, y, w)
  assert.ok(Math.abs(f.params[1] - 1) < 1, '离群点权重低时斜率应接近 1')
})

test('多项式拟合：二次曲线还原系数', () => {
  const x = Array.from({ length: 21 }, (_, i) => i - 10)
  const y = x.map((v) => 1 + 2 * v + 0.5 * v * v)
  const f = polynomialFit(x, y, 2)
  close(f.params[0], 1, 1e-5)
  close(f.params[1], 2, 1e-5)
  close(f.params[2], 0.5, 1e-6)
  close(f.r2, 1, 1e-8)
})

test('LM 非线性拟合：指数衰减模型', () => {
  const x = Array.from({ length: 15 }, (_, i) => i * 0.3)
  const y = x.map((v) => 4 * Math.exp(-0.7 * v) + 0.5)
  const f = nonlinearFit((t, p) => p[0] * Math.exp(-p[1] * t) + p[2], x, y, [3, 0.4, 0.2])
  close(f.params[0], 4, 0.02)
  close(f.params[1], 0.7, 0.02)
  close(f.params[2], 0.5, 0.02)
  assert.ok(f.r2 > 0.999)
  assert.ok(f.ci95.length === 3)
})

test('描述统计与相关性', () => {
  const a = [1, 2, 3, 4, 5]
  close(mean(a), 3)
  close(variance(a), 2.5)
  close(stdev(a), Math.sqrt(2.5))
  close(median([5, 1, 3, 2, 4]), 3)
  close(quantile([0, 10], 0.25), 2.5)
  close(covariance([1, 2, 3], [2, 4, 6]), 2)
  close(pearsonCorrelation([1, 2, 3], [2, 4, 6]), 1)
  assert.ok(studentT95(10) > studentT95(1000))
})

test('离群点：IQR 与 Grubbs', () => {
  const a = [10, 10.2, 9.8, 10.1, 9.9, 50]
  assert.deepEqual(outliersIQR(a), [5])
  const g = grubbsTest(a)
  assert.ok(g && g.index === 5 && g.isOutlier)
})

test('GUM 不确定度传播：乘积的相对合成不确定度', () => {
  const f = (p: number[]) => p[0] * p[1]
  const r = propagateUncertainty(f, [10, 20], [0.1, 0.4])
  close(r.value, 200)
  const expectedRel = Math.sqrt((0.1 / 10) ** 2 + (0.4 / 20) ** 2)
  close(r.relative, expectedRel, 1e-6)
  assert.equal(r.contributions.length, 2)
})

test('蒙特卡洛传播：与 GUM 一阶结果一致（线性模型）', () => {
  const f = (p: number[]) => 2 * p[0] + 3 * p[1]
  const gum = propagateUncertainty(f, [5, 7], [0.2, 0.1])
  const mc = monteCarloUncertainty(f, [5, 7], [0.2, 0.1], 12345, 20000)
  close(mc.mean, 31, 0.03)
  close(mc.sd, gum.sigma, 0.02)
  assert.ok(mc.ci95[0] < 31 && mc.ci95[1] > 31)
  assert.equal(mc.histogram.length, 20)
})

test('FFT 与主频检测：5 Hz 正弦、64 Hz 采样', () => {
  const fs = 64
  const n = 128
  const sig = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 5 * i / fs) + 0.3)
  const { re, im, n: size } = fft(sig)
  assert.equal(size, nextPowerOfTwo(n))
  assert.equal(re.length, size)
  const dom = dominantFrequency(sig, fs)
  assert.ok(dom && Math.abs(dom.freq - 5) < 0.6, `主频 ${dom?.freq}`)
  assert.ok(dom && Math.abs(dom.period - 0.2) < 0.03)
  const sp = powerSpectrum(sig, fs)
  assert.ok(sp.freq.length > 0 && sp.amplitude.length === sp.freq.length)
  assert.ok(sp.amplitude[0] < 0.05, '直流分量应被去均值消除')
  assert.ok(sp.amplitude[10] > 0.1, '5Hz 对应第 10 个频点应为峰值')
})

test('Welch t 检验与正则化 β 函数', () => {
  close(regularizedBeta(2, 3, 1), 1)
  close(regularizedBeta(2, 3, 0), 0)
  const r = welchTTest([1, 2, 3, 2, 1], [10, 11, 12, 11, 10])
  assert.ok(r.p < 0.001, `p=${r.p}`)
  assert.ok(r.meanDiff < 0)
  assert.equal(detrend([1, 1, 1]).length, 3)
})
