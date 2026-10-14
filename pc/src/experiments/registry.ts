import type { ExperimentLogic } from './types'
import { DemoLogic } from './logic/demo'
import { InclineLogic } from './logic/incline'
import { FreeFallLogic } from './logic/freefall'
import { PendulumLogic } from './logic/pendulum'
import { ProjectileLogic } from './logic/projectile'
import { CircuitBasicLogic, OhmLawLogic } from './logic/circuit'
import { LensLogic } from './logic/lens'
import { RefractionLogic } from './logic/refraction'
import { AcidBaseLogic, CombustionLogic, PrecipitateLogic, MetalActivityLogic } from './logic/chem'
import { CellLogic, PhotosynthesisLogic, MicroscopeLogic } from './logic/biology'
import { TitrationLogic, RlcLogic, UncertaintyLogic, GeneticsLogic, EnzymeLogic } from './logic/college'

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
  'physics.refraction': () => new RefractionLogic(),
  'chemistry.acid_base': () => new AcidBaseLogic(),
  'chemistry.combustion': () => new CombustionLogic(),
  'chemistry.precipitate': () => new PrecipitateLogic(),
  'chemistry.metal_activity': () => new MetalActivityLogic(),
  'biology.microscope': () => new MicroscopeLogic(),
  'biology.cell': () => new CellLogic(),
  'biology.photosynthesis': () => new PhotosynthesisLogic(),
  'college.titration': () => new TitrationLogic(),
  'college.rlc': () => new RlcLogic(),
  'college.uncertainty': () => new UncertaintyLogic(),
  'college.genetics': () => new GeneticsLogic(),
  'college.enzyme': () => new EnzymeLogic()
}

export function getLogic(id: string): ExperimentLogic | null {
  const factory = LOGICS[id]
  return factory ? factory() : null
}
