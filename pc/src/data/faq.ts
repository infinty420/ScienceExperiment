/**
 * AI 助教本地知识库（W9 第①级：检索式，全程离线）。
 * 覆盖每个实验的高频问题 + 通用问题；命中关键词即返回。
 * 第②级（端侧小模型）与第③级（云端深度批改）见方案 W9。
 */
export interface FaqItem {
  keys: string[]
  q: string
  a: string
}

export const GENERAL_FAQ: FaqItem[] = [
  {
    keys: ['误差', '不准确', '偏差'],
    q: '为什么实测值和理论值有误差？',
    a: '仿真采用固定步长数值积分（如 1/120s），存在离散化误差；真实实验中还有测量误差与系统误差。减小步长或降低仿真速度可减小误差。'
  },
  {
    keys: ['暂停', '慢放', '慢动作', '速度'],
    q: '能慢放或暂停观察吗？',
    a: '点击「暂停」可冻结画面；力学实验的转速/参数滑杆可降低过程速度。暂停后仍可旋转视角观察三维细节。'
  },
  {
    keys: ['视角', '旋转', '缩放', '操作'],
    q: '怎么调整 3D 视角？',
    a: '在 3D 区域按住鼠标左键拖拽旋转视角，滚轮缩放；触屏设备单指旋转、双指捏合缩放。'
  },
  {
    keys: ['数据', '导出', '报告', '保存'],
    q: '实验数据能导出吗？',
    a: '可以。完成实验后点击「导出报告」生成包含数据表、曲线图与结论的 HTML 报告文件，可直接打印或转 PDF。'
  }
]

/** 按实验 id 的专属 FAQ */
export const EXPERIMENT_FAQ: Record<string, FaqItem[]> = {
  'physics.inclined_plane': [
    { keys: ['静止', '不动', '不滑'], q: '滑块为什么不动？', a: '当 μ ≥ tanθ 时摩擦力足以平衡重力分量，滑块静止。增大倾角或减小摩擦系数即可滑动。' },
    { keys: ['质量', '影响'], q: '质量影响加速度吗？', a: '理想情况下不影响：a = g(sinθ − μcosθ) 与 m 无关（牛顿第二定律两边质量抵消）。可固定角度改变质量验证。' }
  ],
  'physics.free_fall': [
    { keys: ['轻重', '同时', '快'], q: '重的物体落得快吗？', a: '不会。忽略空气阻力时所有物体加速度同为 g，与质量无关——伽利略比萨斜塔实验的结论。' }
  ],
  'physics.pendulum': [
    { keys: ['摆角', '大'], q: '摆角很大时公式还准吗？', a: 'T = 2π√(L/g) 是小角度近似（θ < 10°）。大摆角时周期变长，本实验用 θ″ = −(g/L)sinθ 精确积分，可对比 30° 与 10° 的周期差异。' }
  ],
  'physics.circuit_basic': [
    { keys: ['不亮', '灯', '灭'], q: '灯泡不亮？', a: '检查开关是否闭合（滑杆=1）、电压是否大于 0。若电阻过大电流太小，亮度也会很暗。' }
  ],
  'physics.lens': [
    { keys: ['虚像', '看不到'], q: '为什么虚像是半透明的？', a: '虚像由折射光线的反向延长线（虚线）会聚而成，不能呈在光屏上；半透明+虚线是它的示意画法。' }
  ],
  'chemistry.acid_base': [
    { keys: ['突跃', '跳变'], q: '什么是滴定突跃？', a: '化学计量点附近（V=20mL 前后 0.1%），少量滴定液引起 pH 急剧变化（4.3→9.7），这是选择指示剂的依据。' }
  ],
  'college.titration': [
    { keys: ['缓冲', '平坦'], q: '曲线中段为什么平坦？', a: 'HAc/NaAc 组成缓冲溶液，pH = pKa + log([Ac⁻]/[HAc])，加碱只改变比值，pH 变化缓慢。' }
  ]
}

/** 检索：返回最佳匹配（无命中返回 null） */
export function searchFaq(experimentId: string, question: string): FaqItem | null {
  const pool = [...(EXPERIMENT_FAQ[experimentId] ?? []), ...GENERAL_FAQ]
  const q = question.toLowerCase()
  let best: FaqItem | null = null
  let bestScore = 0
  for (const item of pool) {
    let score = 0
    for (const k of item.keys) {
      if (q.includes(k)) score += k.length
    }
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  return best
}
