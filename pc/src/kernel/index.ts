/**
 * 科学计算内核统一出口（平台无关，PC / 鸿蒙 WebView 共用）
 * 全部模块为纯 TypeScript 独立实现，零第三方运行时依赖。
 */
export * from './linalg'
export * from './rng'
export * from './units'
export * from './expr'
export * from './ode'
export * from './fit'
export * from './stats'
export * from './circuit'

export const KERNEL_VERSION = '3.0.0' as const
