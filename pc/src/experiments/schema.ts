/**
 * 实验包 DSL v2 类型契约
 *
 * 设计目标（参考 NovaSolver / AfriLab / physviz-engine 的元数据组织）：
 * 1. 场景与「怎么算」解耦：solver 声明数值方法，analysis 声明数据分析方法；
 * 2. 每个包携带自身许可证与思想来源，满足开源合规可追溯；
 * 3. 兼容 V1：所有 v2 字段可选，老包不改动也能加载。
 */
import type { SceneDef, QuizDef } from './types'
import type { SolverKind } from '../kernel/ode'

export const DSL_VERSION = '2.0.0'

/** 思想/算法来源致谢（不是代码引用声明） */
export interface Attribution {
  project: string
  /** SPDX 标识；仅作致谢记录，本项目未复用其代码 */
  license: string
  url?: string
  kind: 'idea' | 'algorithm' | 'pedagogy' | 'data'
  note?: string
}

export interface Pedagogy {
  objectives: string[]
  prerequisites?: string[]
  competencies?: string[]
  estimatedMinutes?: number
}

export interface ExperimentMeta {
  dslVersion: string
  version?: string
  subject?: string
  difficulty?: number
  authors?: string[]
  /** 该实验包自身的 SPDX 许可证；内置包为本项目原创 */
  license?: string
  attribution?: Attribution[]
  pedagogy?: Pedagogy
  tags?: string[]
}

/** 数值方法声明：由数值研究台/引擎消费 */
export interface SolverSpec {
  kind: 'ode' | 'analytic' | 'circuit' | 'monte-carlo'
  solver?: SolverKind
  dt?: number
  rtol?: number
  atol?: number
  tEnd?: number
  /** 状态方程右端（安全表达式，见 kernel/expr.ts） */
  equations?: string[]
  stateNames?: string[]
  paramNames?: string[]
  /** 状态初值（缺省全 0） */
  initial?: number[]
  /** 能量表达式，用于守恒诊断 */
  energy?: string
  events?: Array<{ id: string; expression: string }>
  note?: string
}

export interface AnalysisSpec {
  fit?: {
    model: 'linear' | 'polynomial' | 'exponential' | 'michaelis' | 'power'
    xColumn?: string
    yColumn?: string
    degree?: number
  }
  /** GUM 不确定度传播：表达式 + 参数名 + 各自标准差 */
  uncertainty?: { expression: string; params: string[]; sigmas: number[] }
  spectrum?: { column?: string; sampleRate?: number }
  outliers?: boolean
}

export type SceneDefV2 = SceneDef & {
  meta?: ExperimentMeta
  solver?: SolverSpec
  analysis?: AnalysisSpec
}

export interface ExperimentPackage {
  scene: SceneDefV2
  quiz?: QuizDef
  source: 'builtin' | 'imported'
  importedAt?: string
  checksum?: string
}

/** 允许的 SPDX 子集（仅用于提示，不阻断加载） */
export const KNOWN_SPDX = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'Zlib', 'ISC',
  'GPL-2.0', 'GPL-2.0-only', 'GPL-3.0', 'GPL-3.0-only',
  'AGPL-3.0', 'AGPL-3.0-only', 'LGPL-3.0', 'MPL-2.0',
  'CC0-1.0', 'CC-BY-4.0', 'Unlicense', 'NOASSERTION', 'Proprietary'
])
