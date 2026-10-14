import type { PhysObjectDef } from '../engine/physics'

/** 实验包 scene.json 的类型定义（力学子集，W2） */
export interface ParamDef {
  id: string
  label: string
  min: number
  max: number
  step: number
  value: number
  unit?: string
}

export interface RecordColumn {
  id: string
  label: string
  digits?: number
  /** V2：该列测量标准差（自动记录模式下开启"模拟测量误差"时生效） */
  sigma?: number
}

/** V2 虚拟仪器定义（T2） */
export interface InstrumentDef {
  id: string
  type: 'stopwatch' | 'ruler' | 'graduatedCylinder' | 'thermometer' | 'ammeter' | 'voltmeter' | 'balance'
  label: string
  unit?: string
  /** 读数精度（显示小数位） */
  digits?: number
  /** 量程（电表类，超量程打表） */
  range?: [number, number]
  /** 该仪器测量的记录列 id（手动模式下此列不自动记录） */
  recordColumn?: string
}

/** V2 考核目标（T4） */
export interface ExamGoal {
  /** 指标名：匹配结果行"key: value"或内置 rows / rowCount */
  metric: string
  /** 期望真值（数据精度类目标） */
  expect?: number
  /** 容差（|实测-期望|<=tol 满分，线性衰减到 2·tol 为 0） */
  tolerance?: number
  /** 该目标权重分 */
  weight: number
  /** 最少数据组数（数据量类目标） */
  minRecords?: number
}

/** V2 考核定义（T4） */
export interface ExamDef {
  timeLimitSec: number
  goals: ExamGoal[]
  /** 步骤清单（操作事件关键词匹配，命中一项得分） */
  checklist: string[]
}

export interface SceneDef {
  id: string
  title: string
  physics?: { gravity: number }
  camera: { position: number[]; target: number[] }
  ground?: { size: number }
  objects: PhysObjectDef[]
  params: ParamDef[]
  records: RecordColumn[]
  guide: string
  curve?: { x: string; y: string; title: string }
  /** V2：虚拟仪器（缺省 = 全自动记录） */
  instruments?: InstrumentDef[]
  /** V2：考核模式（缺省 = 该实验不提供考核） */
  exam?: ExamDef
}

/** 实验逻辑上下文（由实验台注入） */
export interface ExperimentContext {
  engine: import('../engine/core').Engine
  physics: import('../engine/physics').PhysicsWorld
  def: SceneDef
  post: (type: string, payload: Record<string, unknown>) => void
}

/** 每个实验的专属逻辑（传感器/记录/派生量） */
export interface ExperimentLogic {
  init(ctx: ExperimentContext): void
  onParam(id: string, value: number): void
  start(): void
  pause(): void
  reset(): void
  update(dt: number): void
  dispose(): void
  /** V2 可选：考核评分钩子（返回指标名 → 实测值） */
  evaluate?(ctx: { rows: Row[]; paramValues: Record<string, number> }): Record<string, number>
  /** V2 可选：导出可回放快照（对象位置等，用于录制） */
  snapshot?(): Record<string, number>
}

export type Row = number[]

/** V2：操作事件（AI 诊断 + 考核步骤分 + 录制共用） */
export interface OpEvent {
  t: number
  type: 'param' | 'start' | 'pause' | 'reset' | 'record' | 'instrument' | 'fit'
  detail: string
}

/** V2 题库（T7）：quiz.json */
export interface QuizQuestion {
  q: string
  options: string[]
  answer: number
  explain: string
}

export interface QuizDef {
  preview: QuizQuestion[]
  review: QuizQuestion[]
}
