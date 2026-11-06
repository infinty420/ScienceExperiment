/**
 * 实验包加载器：扫描 experiments/<id>/scene.json，构建场景。
 */
import * as THREE from 'three'
import type { Engine } from '../engine/core'
import { PhysicsWorld } from '../engine/physics'
import type { SceneDef, ExperimentContext, ExperimentLogic, QuizDef } from './types'
import { getLogic } from './registry'
import { registerBuiltin, getRegisteredScene, getRegisteredQuiz, listPackages, allPackageIssues } from './packages'
import { GenericNumericLogic } from './logic/generic'
import type { ValidationReport } from './validate'

const modules = import.meta.glob('../../experiments/*/scene.json', {
  eager: true,
  import: 'default'
}) as Record<string, SceneDef>

const SCENES: Map<string, SceneDef> = new Map()
for (const def of Object.values(modules)) {
  SCENES.set(def.id, def)
}

/** V2 题库：experiments/<id>/quiz.json（可选） */
const quizModules = import.meta.glob('../../experiments/*/quiz.json', {
  eager: true,
  import: 'default'
}) as Record<string, QuizDef>

const QUIZZES: Map<string, QuizDef> = new Map()
for (const [path, quiz] of Object.entries(quizModules)) {
  const m = path.match(/experiments\/([^/]+)\/quiz\.json$/)
  if (m) QUIZZES.set(m[1], quiz)
}

// V3：把编译期内置包注册到统一注册中心（迁移 + 校验，仅收集问题不阻断）
for (const [id, def] of SCENES) registerBuiltin(def, QUIZZES.get(id))

export function getQuiz(id: string): QuizDef | undefined {
  return getRegisteredQuiz(id) ?? QUIZZES.get(id)
}

export function getSceneDef(id: string): SceneDef | undefined {
  return getRegisteredScene(id) ?? SCENES.get(id)
}

export function allSceneIds(): string[] {
  return [...new Set([...SCENES.keys(), ...listPackages().map((p) => p.scene.id)])]
}

/** V3：全部实验包的校验问题（供「关于/诊断」页面展示） */
export function packageIssues(): Array<{ id: string; report: ValidationReport }> {
  return allPackageIssues()
}

/** 按定义构建场景，返回 {physics, logic}；调用方负责每帧 step/update */
export function buildExperiment(engine: Engine, def: SceneDef, post: (t: string, p: Record<string, unknown>) => void): {
  physics: PhysicsWorld
  logic: ExperimentLogic
} | null {
  // V3：导入包没有专属 TS 逻辑时，用声明式数值方程驱动通用求解器
  const logic: ExperimentLogic | null = getLogic(def.id)
    ?? (def.solver?.equations?.length ? new GenericNumericLogic() : null)
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
