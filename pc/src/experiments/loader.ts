/**
 * 实验包加载器：扫描 experiments/<id>/scene.json，构建场景。
 */
import * as THREE from 'three'
import type { Engine } from '../engine/core'
import { PhysicsWorld } from '../engine/physics'
import type { SceneDef, ExperimentContext, ExperimentLogic } from './types'
import { getLogic } from './registry'

const modules = import.meta.glob('../../experiments/*/scene.json', {
  eager: true,
  import: 'default'
}) as Record<string, SceneDef>

const SCENES: Map<string, SceneDef> = new Map()
for (const def of Object.values(modules)) {
  SCENES.set(def.id, def)
}

export function getSceneDef(id: string): SceneDef | undefined {
  return SCENES.get(id)
}

export function allSceneIds(): string[] {
  return [...SCENES.keys()]
}

/** 按定义构建场景，返回 {physics, logic}；调用方负责每帧 step/update */
export function buildExperiment(engine: Engine, def: SceneDef, post: (t: string, p: Record<string, unknown>) => void): {
  physics: PhysicsWorld
  logic: ExperimentLogic
} | null {
  const logic = getLogic(def.id)
  if (!logic) return null

  // 相机
  engine.setCamera(def.camera.position, def.camera.target)

  // 地面（视觉网格 + 物理平面）
  const physics = new PhysicsWorld(def.physics?.gravity ?? 9.8)
  if (def.ground) {
    const s = def.ground.size ?? 30
    const grid = new THREE.GridHelper(s * 2, s * 2, 0x3d5266, 0x273543)
    engine.scene.add(grid)
    physics.add(engine, {
      id: '__ground',
      type: 'plane',
      position: [0, 0, 0],
      rotation: [-Math.PI / 2, 0, 0],
      static: true,
      visible: false,
      friction: 0.4
    })
  }

  // 对象
  for (const obj of def.objects) {
    physics.add(engine, obj)
  }

  const ctx: ExperimentContext = { engine, physics, def, post }
  logic.init(ctx)
  return { physics, logic }
}
