/**
 * V2 参数扫描引擎（T9）：headless 批量仿真。
 * 复用当前 Engine/Physics/Logic 实例，跳过渲染循环——
 * 对每个参数值：reset → onParam → start → 固定步长步进 → 收集 result 指标。
 */
import type { Engine } from '../engine/core'
import type { PhysicsWorld } from '../engine/physics'
import type { ExperimentLogic, SceneDef } from './types'

export interface ScanPoint {
  param: number
  metrics: Record<string, number>
}

export interface ScanResult {
  points: ScanPoint[]
  /** 自动寻优（对第一个指标） */
  optimum: { param: number; value: number } | null
  metricName: string
}

/** 从结果行解析指标："反推 g = 4π²L/T² = 9.79 m/s²" → {g: 9.79} */
function parseMetrics(lines: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of lines) {
    // 中文/字母指标名 + 等号 + 数值
    const m = line.match(/([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z₀¹²π ]*?)\s*[=:：]\s*(-?\d+\.?\d*(?:e-?\d+)?)/g)
    if (m) {
      for (const seg of m) {
        const mm = seg.match(/([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z₀¹²π ]*?)\s*[=:：]\s*(-?\d+\.?\d*(?:e-?\d+)?)/)
        if (mm) {
          const name = mm[1].trim()
          const v = Number(mm[2])
          if (!Number.isNaN(v) && name.length <= 8) out[name] = v
        }
      }
    }
  }
  return out
}

/**
 * 参数扫描：
 * @param simSeconds 每组参数的仿真时长（秒，仿真时间）
 * @param onProgress 进度回调 (完成组数, 总组数)
 */
export function paramScan(
  engine: Engine,
  physics: PhysicsWorld,
  logic: ExperimentLogic,
  def: SceneDef,
  paramId: string,
  values: number[],
  simSeconds = 12,
  onProgress?: (done: number, total: number) => void
): ScanResult {
  // 保存当前视图状态
  const wasTimeScale = engine.timeScale
  engine.timeScale = 1

  // 拦截 post 收集 result
  let captured: string[] = []
  const capturedRows: number[][] = []
  const hijack = (type: string, payload: Record<string, unknown>): void => {
    if (type === 'result') captured = payload.lines as string[]
    else if (type === 'rows') capturedRows.push(...(payload.rows as number[][]))
    else if (type === 'data') capturedRows.push(payload.row as number[])
  }
  const ctxPost = (logic as unknown as { ctx?: { post: (t: string, p: Record<string, unknown>) => void } }).ctx
  const origPost = ctxPost?.post
  if (ctxPost) ctxPost.post = hijack

  const points: ScanPoint[] = []
  const dt = 1 / 120
  const steps = Math.ceil(simSeconds / dt)

  try {
    for (let i = 0; i < values.length; i++) {
      captured = []
      capturedRows.length = 0
      logic.reset()
      logic.onParam(paramId, values[i])
      logic.start()
      for (let s = 0; s < steps; s++) {
        physics.step(dt)
        logic.update(dt)
      }
      logic.pause()
      let metrics = parseMetrics(captured)
      // 兜底：无 result 时取最后一行数据（如自由落体瞬时值）
      if (Object.keys(metrics).length === 0 && capturedRows.length > 0) {
        metrics = { 'y': capturedRows[capturedRows.length - 1][1] ?? 0 }
      }
      points.push({ param: values[i], metrics })
      onProgress?.(i + 1, values.length)
    }
  } finally {
    logic.reset()
    if (ctxPost && origPost) ctxPost.post = origPost
    engine.timeScale = wasTimeScale
    void def
  }

  // 自动寻优：取所有点第一个指标的最大值（若全为常数则无极值）
  let metricName = ''
  for (const p of points) {
    const keys = Object.keys(p.metrics)
    if (keys.length > 0) {
      metricName = metricName || keys[keys.length - 1]
      break
    }
  }
  let optimum: ScanResult['optimum'] = null
  if (metricName) {
    let best: ScanPoint | null = null
    for (const p of points) {
      const v = p.metrics[metricName]
      if (v === undefined) continue
      if (!best || v > (best.metrics[metricName] ?? -Infinity)) best = p
    }
    if (best && best.metrics[metricName] !== undefined) {
      optimum = { param: best.param, value: best.metrics[metricName] }
    }
  }
  return { points, optimum, metricName }
}

/** 黄金分割寻优（用于自动求极值场景，当前以扫描为主，保留备用） */
export function goldenSearch(
  f: (x: number) => number,
  lo: number,
  hi: number,
  tol = 0.01
): number {
  const gr = (Math.sqrt(5) - 1) / 2
  let a = lo
  let b = hi
  let c = b - gr * (b - a)
  let d = a + gr * (b - a)
  while (Math.abs(b - a) > tol) {
    if (f(c) > f(d)) {
      b = d
    } else {
      a = c
    }
    c = b - gr * (b - a)
    d = a + gr * (b - a)
  }
  return (a + b) / 2
}
