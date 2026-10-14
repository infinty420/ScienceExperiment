export interface SubjectInfo {
  key: string
  label: string
  icon: string
  color: string
}

export interface ExperimentInfo {
  id: string
  title: string
  subject: string
  subjectLabel: string
  difficulty: number // 1~3
  wave: string
  available: boolean
}

export const SUBJECTS: SubjectInfo[] = [
  { key: 'physics', label: '物理', icon: '⚛', color: '#3f8f79' },
  { key: 'chemistry', label: '化学', icon: '⚗', color: '#b3702d' },
  { key: 'biology', label: '生物', icon: '🧬', color: '#4a7dc0' },
  { key: 'college', label: '大学实验', icon: '🎓', color: '#7f5fb8' }
]

export const EXPERIMENTS: ExperimentInfo[] = [
  // W1 渲染管线验证（演示实验，始终可用）
  { id: 'w1.demo', title: 'W1 渲染管线验证 · 3D 实验台', subject: 'demo', subjectLabel: '演示', difficulty: 1, wave: 'W1', available: true },

  // 物理 W2 力学
  { id: 'physics.inclined_plane', title: '斜面上物体运动探究', subject: 'physics', subjectLabel: '物理', difficulty: 1, wave: 'W2', available: true },
  { id: 'physics.free_fall', title: '自由落体运动测定', subject: 'physics', subjectLabel: '物理', difficulty: 1, wave: 'W2', available: true },
  { id: 'physics.pendulum', title: '单摆测重力加速度', subject: 'physics', subjectLabel: '物理', difficulty: 2, wave: 'W2', available: true },
  { id: 'physics.projectile', title: '平抛运动规律探究', subject: 'physics', subjectLabel: '物理', difficulty: 2, wave: 'W2', available: true },
  // 物理 W3 电学/光学
  { id: 'physics.circuit_basic', title: '基础电路搭建', subject: 'physics', subjectLabel: '物理', difficulty: 2, wave: 'W3', available: true },
  { id: 'physics.lens', title: '凸透镜成像规律', subject: 'physics', subjectLabel: '物理', difficulty: 1, wave: 'W3', available: true },
  { id: 'physics.refraction', title: '光的折射与全反射', subject: 'physics', subjectLabel: '物理', difficulty: 2, wave: 'W3', available: true },
  { id: 'physics.ohm_law', title: '欧姆定律验证', subject: 'physics', subjectLabel: '物理', difficulty: 1, wave: 'W3', available: true },
  // 化学 W4
  { id: 'chemistry.acid_base', title: '酸碱中和滴定（初中）', subject: 'chemistry', subjectLabel: '化学', difficulty: 1, wave: 'W4', available: false },
  { id: 'chemistry.combustion', title: '燃烧条件探究', subject: 'chemistry', subjectLabel: '化学', difficulty: 1, wave: 'W4', available: false },
  { id: 'chemistry.precipitate', title: '沉淀反应与颜色变化', subject: 'chemistry', subjectLabel: '化学', difficulty: 2, wave: 'W4', available: false },
  { id: 'chemistry.metal_activity', title: '金属活动性顺序', subject: 'chemistry', subjectLabel: '化学', difficulty: 1, wave: 'W4', available: false },
  { id: 'chemistry.gas_prepare', title: '氧气制备与检验', subject: 'chemistry', subjectLabel: '化学', difficulty: 2, wave: 'W4', available: false },
  // 生物 W5
  { id: 'biology.microscope', title: '显微镜的使用', subject: 'biology', subjectLabel: '生物', difficulty: 1, wave: 'W5', available: false },
  { id: 'biology.cell', title: '细胞结构 3D 探索', subject: 'biology', subjectLabel: '生物', difficulty: 1, wave: 'W5', available: false },
  { id: 'biology.photosynthesis', title: '光合作用过程模拟', subject: 'biology', subjectLabel: '生物', difficulty: 2, wave: 'W5', available: false },
  // 大学 W7
  { id: 'college.titration', title: '酸碱滴定分析（曲线绘制）', subject: 'college', subjectLabel: '大学实验', difficulty: 2, wave: 'W7', available: false },
  { id: 'college.rlc', title: 'RLC 串联电路谐振', subject: 'college', subjectLabel: '大学实验', difficulty: 3, wave: 'W7', available: false },
  { id: 'college.uncertainty', title: '测量不确定度评定', subject: 'college', subjectLabel: '大学实验', difficulty: 2, wave: 'W7', available: false },
  { id: 'college.genetics', title: '孟德尔遗传杂交模拟', subject: 'college', subjectLabel: '大学实验', difficulty: 2, wave: 'W7', available: false },
  { id: 'college.enzyme', title: '酶动力学（米氏方程）', subject: 'college', subjectLabel: '大学实验', difficulty: 3, wave: 'W7', available: false }
]

export function experimentsOf(subject: string): ExperimentInfo[] {
  return EXPERIMENTS.filter((e) => e.subject === subject)
}

export function difficultyLabel(d: number): string {
  if (d <= 1) return '基础'
  if (d === 2) return '进阶'
  return '挑战'
}
