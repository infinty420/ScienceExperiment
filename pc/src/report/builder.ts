/**
 * 实验报告 3.0：结构化报告对象（假设 / 方法 / 数据 / 拟合 / 不确定度 / 结论 / 溯源）
 * 参考 CODAP (MIT) 的教学数据流理念；所有渲染与计算均为本项目自研。
 */
import type { FitResult } from '../kernel/fit'
import type { GUMResult, MCResult } from '../kernel/stats'
import type { Attribution } from '../experiments/schema'
import type { ExperimentSnapshot } from '../learning/snapshot'

export interface ReportInput {
  experimentId: string
  title: string
  subject?: string
  student?: string
  guide?: string
  params: Record<string, number>
  paramLabels?: Record<string, string>
  rows: number[][]
  headers?: string[]
  resultLines?: string[]
  fit?: FitResult | null
  gum?: GUMResult | null
  mc?: MCResult | null
  solverNotes?: string[]
  dominantFrequency?: { freq: number; amplitude: number; period: number } | null
  snapshot?: ExperimentSnapshot | null
  attribution?: Attribution[]
  createdAt?: number
}

export interface ReportSection {
  key: string
  title: string
  paragraphs: string[]
  table?: { headers: string[]; rows: string[][] }
  bullets?: string[]
}

export interface LabReport {
  version: '3.0'
  experimentId: string
  title: string
  subject: string
  student: string
  createdAt: number
  sections: ReportSection[]
  checksum?: string
}

function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '—'
  return Number(v.toPrecision(digits)).toString()
}

export function buildReport(input: ReportInput): LabReport {
  const createdAt = input.createdAt ?? Date.now()
  const headers = input.headers ?? input.rows[0]?.map((_, i) => `列 ${i + 1}`) ?? []
  const sections: ReportSection[] = []

  sections.push({
    key: 'metadata',
    title: '一、实验信息',
    paragraphs: [
      `实验：${input.title}（${input.experimentId}）`,
      `学科：${input.subject ?? input.experimentId.split('.')[0]}　学习者：${input.student ?? '默认学习者'}`,
      `生成时间：${new Date(createdAt).toLocaleString('zh-CN')}　数据量：${input.rows.length} 组`
    ]
  })

  sections.push({
    key: 'hypothesis',
    title: '二、实验目的与假设',
    paragraphs: input.guide ? [input.guide] : ['通过改变自变量观测因变量变化，验证物理量之间的定量关系。']
  })

  const paramRows = Object.entries(input.params).map(([k, v]) => [input.paramLabels?.[k] ?? k, fmt(v, 6), k])
  sections.push({
    key: 'method',
    title: '三、方法与条件',
    paragraphs: [
      '采用控制变量法：保持其余参数不变，逐次改变自变量并记录读数；数值求解器与误差模型由 V3 科学计算内核提供。',
      ...(input.solverNotes ?? [])
    ],
    table: paramRows.length ? { headers: ['参数', '取值', '标识'], rows: paramRows } : undefined
  })

  sections.push({
    key: 'data',
    title: '四、原始数据',
    paragraphs: [`共 ${input.rows.length} 组有效数据，列：${headers.join(' / ') || '（无）'}。`],
    table: {
      headers,
      rows: input.rows.slice(0, 200).map((r) => r.map((v) => fmt(v, 6)))
    }
  })

  const analysis: string[] = []
  if (input.fit) {
    analysis.push(
      `${input.fit.label}：参数 ${input.fit.params.map((p) => fmt(p, 6)).join(', ')}；R² = ${fmt(input.fit.r2, 6)}，调整 R² = ${fmt(input.fit.adjR2, 6)}，RMSE = ${fmt(input.fit.rmse, 4)}。`,
      `参数 95% 置信区间：${input.fit.ci95.map(([lo, hi], i) => `p${i} ∈ [${fmt(lo)}, ${fmt(hi)}]`).join('；')}。`,
      `模型选择：AIC = ${fmt(input.fit.aic, 4)}，BIC = ${fmt(input.fit.bic, 4)}；设计矩阵条件数 κ = ${fmt(input.fit.condition, 4)}（越大越病态）。`
    )
  }
  if (input.dominantFrequency) {
    analysis.push(`频谱分析主频 ${fmt(input.dominantFrequency.freq, 5)} Hz（周期 ${fmt(input.dominantFrequency.period, 5)} s，幅值 ${fmt(input.dominantFrequency.amplitude, 4)}）。`)
  }
  if (!analysis.length) analysis.push('本次未执行拟合或频谱分析；可在实验台「分析」面板补充。')
  sections.push({ key: 'analysis', title: '五、数据处理与分析', paragraphs: analysis })

  const uncertainty: string[] = []
  if (input.gum) {
    uncertainty.push(`GUM 一阶传播：y = ${fmt(input.gum.value, 6)}，合成标准不确定度 u = ${fmt(input.gum.sigma, 4)}，相对不确定度 ${fmt(input.gum.relative * 100, 3)}%。`)
    uncertainty.push(`各输入量贡献：${input.gum.contributions.map((c, i) => `x${i} = ${fmt(c, 4)}`).join('，')}。`)
  }
  if (input.mc) {
    uncertainty.push(`蒙特卡洛（${input.mc.samples} 次）：均值 ${fmt(input.mc.mean, 6)}，标准差 ${fmt(input.mc.sd, 4)}，95% 区间 [${fmt(input.mc.ci95[0], 5)}, ${fmt(input.mc.ci95[1], 5)}]。`)
  }
  if (!uncertainty.length) uncertainty.push('未进行不确定度评定；建议对关键测量量补充 GUM 与蒙特卡洛双重校验。')
  sections.push({ key: 'uncertainty', title: '六、测量不确定度', paragraphs: uncertainty })

  const conclusions = reportFindings({ fit: input.fit, resultLines: input.resultLines ?? [], rowCount: input.rows.length })
  sections.push({
    key: 'conclusion',
    title: '七、结论',
    paragraphs: conclusions,
    bullets: (input.resultLines ?? []).slice(0, 12)
  })

  const repro: string[] = []
  if (input.snapshot) {
    repro.push(`快照 ID：${input.snapshot.id}`)
    repro.push(`SHA-256：${input.snapshot.checksum}`)
    repro.push(`随机种子：${String(input.snapshot.seed)}　求解器：${input.snapshot.solver?.solver ?? '未声明'}　校验：${'见快照文件'}`)
    repro.push('导入该快照可复跑实验并逐点比对数据，实现结果可复现。')
  } else {
    repro.push('本次未导出可复现快照；建议在实验台点击「保存快照」以便复现与查证。')
  }
  sections.push({ key: 'reproducibility', title: '八、可复现性', paragraphs: repro })

  if (input.attribution?.length) {
    sections.push({
      key: 'attribution',
      title: '九、参考与致谢',
      paragraphs: ['本项目代码为独立实现，以下项目仅作为教学设计或算法思想的参考，未复用其代码、资源与商标。'],
      bullets: input.attribution.map((a) => `${a.project}（${a.license}）：${a.note ?? a.kind}${a.url ? ` ${a.url}` : ''}`)
    })
  }

  return {
    version: '3.0',
    experimentId: input.experimentId,
    title: input.title,
    subject: input.subject ?? input.experimentId.split('.')[0],
    student: input.student ?? '默认学习者',
    createdAt,
    sections,
    checksum: input.snapshot?.checksum
  }
}

/** 依据拟合优度与数据量自动生成结论要点 */
export function reportFindings(input: { fit?: FitResult | null; resultLines: string[]; rowCount: number }): string[] {
  const out: string[] = []
  if (input.fit) {
    if (input.fit.r2 >= 0.99) out.push('数据与模型高度一致（R² ≥ 0.99），在测量不确定度范围内支持原假设。')
    else if (input.fit.r2 >= 0.95) out.push('数据与模型基本一致，但仍有可察觉的系统偏差，建议检查仪器零点与环境变量。')
    else out.push('线性假设不成立或存在显著干扰，建议改用非线性模型或排查异常数据点。')
    if (input.fit.condition > 1e8) out.push('设计矩阵病态（κ > 10⁸），参数估计对噪声敏感，建议扩大自变量取值范围。')
  } else {
    out.push('本次未做定量拟合，结论以观测现象与原始结果为主。')
  }
  if (input.rowCount < 5) out.push('数据量少于 5 组，统计结论的置信度有限，建议补测。')
  if (input.resultLines.some((l) => /误差|偏离|系统/.test(l))) out.push('结果行中出现误差相关提示，需结合不确定度评定一并解读。')
  return out
}
