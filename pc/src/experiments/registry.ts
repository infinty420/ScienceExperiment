import type { ExperimentLogic } from './types'
import { DemoLogic } from './logic/demo'
import { InclineLogic } from './logic/incline'
import { FreeFallLogic } from './logic/freefall'
import { PendulumLogic } from './logic/pendulum'
import { ProjectileLogic } from './logic/projectile'
import { CircuitBasicLogic, OhmLawLogic } from './logic/circuit'
import { LensLogic } from './logic/lens'
import { RefractionLogic } from './logic/refraction'

/** 实验逻辑注册表：scene.json 的 id -> 逻辑实现 */
const LOGICS: Record<string, () => ExperimentLogic> = {
  'w1.demo': () => new DemoLogic(),
  'physics.inclined_plane': () => new InclineLogic(),
  'physics.free_fall': () => new FreeFallLogic(),
  'physics.pendulum': () => new PendulumLogic(),
  'physics.projectile': () => new ProjectileLogic(),
  'physics.circuit_basic': () => new CircuitBasicLogic(),
  'physics.ohm_law': () => new OhmLawLogic(),
  'physics.lens': () => new LensLogic(),
  'physics.refraction': () => new RefractionLogic()
}

export function getLogic(id: string): ExperimentLogic | null {
  const factory = LOGICS[id]
  return factory ? factory() : null
}
