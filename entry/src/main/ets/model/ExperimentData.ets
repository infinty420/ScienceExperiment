/**
 * 实验元信息数据模型（W1 预置静态数据；W8 起由 RelationalStore 接管）。
 */

export class ExperimentInfo {
  id: string;
  title: string;
  subject: string;      // physics / chemistry / biology / college
  subjectLabel: string;
  difficulty: number;   // 1~3
  wave: string;         // 所属路线图阶段
  available: boolean;   // W1 仅演示实验可用

  constructor(id: string, title: string, subject: string, subjectLabel: string,
    difficulty: number, wave: string, available: boolean) {
    this.id = id;
    this.title = title;
    this.subject = subject;
    this.subjectLabel = subjectLabel;
    this.difficulty = difficulty;
    this.wave = wave;
    this.available = available;
  }
}

export class SubjectInfo {
  key: string;
  label: string;
  emoji: string; // 占位图标字符，W6 换媒体资源
  color: string;
  count: number;

  constructor(key: string, label: string, emoji: string, color: string, count: number) {
    this.key = key;
    this.label = label;
    this.emoji = emoji;
    this.color = color;
    this.count = count;
  }
}

export class ExperimentRepository {
  static getSubjects(): SubjectInfo[] {
    return [
      new SubjectInfo('physics', '物理', '⚛', '#3f8f79', 8),
      new SubjectInfo('chemistry', '化学', '⚗', '#b3702d', 5),
      new SubjectInfo('biology', '生物', '🧬', '#4a7dc0', 3),
      new SubjectInfo('college', '大学实验', '🎓', '#7f5fb8', 5)
    ];
  }

  static getExperiments(subject: string): ExperimentInfo[] {
    const all: ExperimentInfo[] = [
      // 物理 W2 力学
      new ExperimentInfo('physics.inclined_plane', '斜面上物体运动探究', 'physics', '物理', 1, 'W2', false),
      new ExperimentInfo('physics.free_fall', '自由落体运动测定', 'physics', '物理', 1, 'W2', false),
      new ExperimentInfo('physics.pendulum', '单摆测重力加速度', 'physics', '物理', 2, 'W2', false),
      new ExperimentInfo('physics.projectile', '平抛运动规律探究', 'physics', '物理', 2, 'W2', false),
      // 物理 W3 电学/光学
      new ExperimentInfo('physics.circuit_basic', '基础电路搭建', 'physics', '物理', 2, 'W3', false),
      new ExperimentInfo('physics.lens', '凸透镜成像规律', 'physics', '物理', 1, 'W3', false),
      new ExperimentInfo('physics.refraction', '光的折射与全反射', 'physics', '物理', 2, 'W3', false),
      new ExperimentInfo('physics.ohm_law', '欧姆定律验证', 'physics', '物理', 1, 'W3', false),
      // 化学 W4
      new ExperimentInfo('chemistry.acid_base', '酸碱中和滴定（初中）', 'chemistry', '化学', 1, 'W4', false),
      new ExperimentInfo('chemistry.combustion', '燃烧条件探究', 'chemistry', '化学', 1, 'W4', false),
      new ExperimentInfo('chemistry.precipitate', '沉淀反应与颜色变化', 'chemistry', '化学', 2, 'W4', false),
      new ExperimentInfo('chemistry.metal_activity', '金属活动性顺序', 'chemistry', '化学', 1, 'W4', false),
      new ExperimentInfo('chemistry.gas_prepare', '氧气制备与检验', 'chemistry', '化学', 2, 'W4', false),
      // 生物 W5
      new ExperimentInfo('biology.microscope', '显微镜的使用', 'biology', '生物', 1, 'W5', false),
      new ExperimentInfo('biology.cell', '细胞结构 3D 探索', 'biology', '生物', 1, 'W5', false),
      new ExperimentInfo('biology.photosynthesis', '光合作用过程模拟', 'biology', '生物', 2, 'W5', false),
      // 大学 W7
      new ExperimentInfo('college.titration', '酸碱滴定分析（曲线绘制）', 'college', '大学实验', 2, 'W7', false),
      new ExperimentInfo('college.rlc', 'RLC 串联电路谐振', 'college', '大学实验', 3, 'W7', false),
      new ExperimentInfo('college.uncertainty', '测量不确定度评定', 'college', '大学实验', 2, 'W7', false),
      new ExperimentInfo('college.genetics', '孟德尔遗传杂交模拟', 'college', '大学实验', 2, 'W7', false),
      new ExperimentInfo('college.enzyme', '酶动力学（米氏方程）', 'college', '大学实验', 3, 'W7', false)
    ];
    const result: ExperimentInfo[] = [];
    for (const item of all) {
      if (item.subject === subject) {
        result.push(item);
      }
    }
    return result;
  }

  static getExperimentById(id: string): ExperimentInfo | undefined {
    const subjects: string[] = ['physics', 'chemistry', 'biology', 'college'];
    for (const s of subjects) {
      const list: ExperimentInfo[] = ExperimentRepository.getExperiments(s);
      for (const item of list) {
        if (item.id === id) {
          return item;
        }
      }
    }
    return undefined;
  }
}
