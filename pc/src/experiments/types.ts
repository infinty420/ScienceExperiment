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
}

export type Row = number[]
