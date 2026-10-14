/**
 * V2 蒙特卡洛误差引擎（T5）
 * - gaussNoise：Box-Muller 标准正态采样
 * - 仪器精度表：常见虚拟仪器的测量标准差（教学合理值）
 * - measure：真值 → 含噪读数
 * 3D 世界运行真值（sim），数据表记录含噪值（measured），
 * 使线性拟合的 R²、截距等表现与真实实验室一致。
 */

/** Box-Muller 变换：标准正态 N(0,1) 采样 */
export function gaussNoise(sigma = 1): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** 仪器类型 → 测量标准差（σ，按物理单位） */
export const INSTRUMENT_SIGMA: Record<string, number> = {
  stopwatch: 0.2,        // 秒表：人的反应延迟
  ruler: 0.0005,         // 米尺：0.5mm
  vernier: 0.00002,      // 游标卡尺：0.02mm
  graduatedCylinder: 0.0005, // 量筒：0.5mL（按 L 记）
  thermometer: 0.2,      // 温度计：0.2°C
  ammeter: 0.005,        // 电流表：5mA
  voltmeter: 0.05,       // 电压表：0.05V
  balance: 0.0001        // 天平：0.1g
}

/** 真值 → 含高斯噪声的读数 */
export function measure(trueValue: number, sigma: number): number {
  if (sigma <= 0) return trueValue
  return trueValue + gaussNoise(sigma)
}

/** 按仪器 id 取 σ（未知仪器返回 0，即不加噪） */
export function sigmaOf(instrumentId: string): number {
  return INSTRUMENT_SIGMA[instrumentId] ?? 0
}

/**
 * 不确定度传播（一元线性拟合 y = a·x + b）：
 * σa = σy · sqrt(1 / Σ(xi - x̄)²)
 * σb = σy · sqrt(1/n + x̄² / Σ(xi - x̄)²)
 */
export function fitUncertainty(
  xs: number[],
  sigmaY: number
): { sigmaA: number; sigmaB: number } | null {
  const n = xs.length
  if (n < 3) return null
  const xm = xs.reduce((s, v) => s + v, 0) / n
  let sxx = 0
  for (const x of xs) sxx += (x - xm) * (x - xm)
  if (sxx < 1e-15) return null
  const sigmaA = sigmaY * Math.sqrt(1 / sxx)
  const sigmaB = sigmaY * Math.sqrt(1 / n + (xm * xm) / sxx)
  return { sigmaA, sigmaB }
}
