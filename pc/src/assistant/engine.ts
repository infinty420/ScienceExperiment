/**
 * AI 助教 2.0：BM25 检索增强 + 规则诊断 + 可插拔大模型适配器
 * 默认全离线（桌面 / 鸿蒙 WebView 无需联网）；接入端侧或云端模型时只需 setAdapter。
 */
import { buildIndex, search, type BM25Index, type Doc } from './retrieval'
import { FORMULA_LIBRARY, findFormula, renderLatex, type FormulaEntry } from './formula'
import { linearFit } from '../kernel/fit'
import { outliersIQR } from '../kernel/stats'

export interface AssistantContext {
  experimentId?: string
  rows?: number[][]
  paramValues?: Record<string, number>
  fitR2?: number | null
}
export interface AssistantAnswer {
  text: string
  sources: Array<{ id: string; title: string }>
  formula?: FormulaEntry
  formulaHtml?: string
  diagnostics: string[]
  mode: 'offline' | 'llm'
}
export interface LLMAdapter {
  ask(question: string, context: AssistantContext, evidence: string[]): Promise<string>
}

const FORMULA_DOCS: Doc[] = FORMULA_LIBRARY.map((f) => ({
  id: `formula.${f.id}`,
  title: f.name,
  body: `${f.description}。公式：${f.latex}。所属主题：${f.topic}`,
  tags: ['公式', f.topic, f.id]
}))

export function diagnoseRows(rows: number[][]): string[] {
  const out: string[] = []
  if (!rows || rows.length === 0) return ['暂无数据。先运行实验并记录至少 5 组数据，才能得到可靠诊断。']
  if (rows.length < 5) out.push(`仅 ${rows.length} 组数据，统计结论不稳定，建议至少补测到 5 组。`)
  const cols = rows[0]?.length ?? 0
  for (let j = 0; j < cols; j++) {
    const col = rows.map((r) => r[j]).filter(Number.isFinite)
    if (col.length >= 2 && Math.max(...col) - Math.min(...col) < 1e-12) {
      out.push(`第 ${j + 1} 列几乎没有变化，若它是自变量则无法拟合出有效关系。`)
    }
    if (col.length >= 4) {
      const idx = outliersIQR(col)
      if (idx.length) out.push(`第 ${j + 1} 列检测到 ${idx.length} 个离群点（IQR 准则），建议复核仪器读数。`)
    }
  }
  if (cols >= 2 && rows.length >= 3) {
    const x = rows.map((r) => r[0])
    const y = rows.map((r) => r[1])
    try {
      const f = linearFit(x, y)
      if (f.r2 < 0.95) out.push(`线性拟合 R² = ${f.r2.toFixed(3)}，偏低；可能是非线性关系、系统误差或异常点。`)
      else out.push(`线性拟合 R² = ${f.r2.toFixed(3)}，数据与直线模型吻合良好。`)
    } catch { /* 数据退化时跳过 */ }
  }
  if (!out.length) out.push('数据分布与线性模型均无异常，可继续进入不确定度评定。')
  return out
}

export class AssistantEngine {
  private index: BM25Index
  private adapter: LLMAdapter | null = null

  constructor(docs: Doc[] = []) {
    this.index = buildIndex([...docs, ...FORMULA_DOCS])
  }

  setAdapter(adapter: LLMAdapter | null): void {
    this.adapter = adapter
  }

  setDocs(docs: Doc[]): void {
    this.index = buildIndex([...docs, ...FORMULA_DOCS])
  }

  /** 同步离线问答（默认路径） */
  ask(question: string, context: AssistantContext = {}): AssistantAnswer {
    const hits = search(this.index, question, 3)
    const diagnostics = diagnoseRows(context.rows ?? [])
    const formula = findFormula(question) ?? (hits[0]?.doc.id.startsWith('formula.')
      ? FORMULA_LIBRARY.find((f) => hits[0].doc.id === `formula.${f.id}`)
      : undefined)
    const sources = hits.map((h) => ({ id: h.doc.id, title: h.doc.title }))

    let text: string
    if (hits.length && hits[0].score > 0.5) {
      const main = hits[0].doc
      const excerpt = main.body.replace(/\s+/g, ' ').slice(0, 220)
      text = `【${main.title}】${excerpt}${main.body.length > 220 ? '…' : ''}`
      if (hits.length > 1) text += `\n\n相关条目：${hits.slice(1).map((h) => h.doc.title).join('、')}。`
      if (context.experimentId) text += `\n\n当前实验：${context.experimentId}。`
      if (diagnostics.length && /误差|数据|结果|拟合|异常/.test(question)) {
        text += `\n\n针对当前数据的诊断：${diagnostics.join(' ')}`
      }
    } else {
      text = '离线知识库中未找到直接匹配的条目。可以先查看「公式速查」，或换用更具体的物理量名称提问（例如「单摆周期」「欧姆定律」「不确定度」）。'
      if (diagnostics.length) text += `\n\n当前数据诊断：${diagnostics.join(' ')}`
    }
    if (formula) text += `\n\n公式：${formula.latex}\n${formula.description}`
    return {
      text,
      sources,
      formula,
      formulaHtml: formula ? renderLatex(formula.latex) : undefined,
      diagnostics,
      mode: 'offline'
    }
  }

  /** 异步问答：配置了适配器则走模型，并用检索结果作为证据；失败自动回退离线 */
  async askAsync(question: string, context: AssistantContext = {}): Promise<AssistantAnswer> {
    const offline = this.ask(question, context)
    if (!this.adapter) return offline
    try {
      const evidence = search(this.index, question, 3).map((h) => `${h.doc.title}：${h.doc.body}`)
      const answer = await this.adapter.ask(question, context, evidence)
      return { ...offline, text: answer, mode: 'llm' }
    } catch {
      return { ...offline, text: `${offline.text}\n\n（模型通道不可用，已回退离线检索结果）` }
    }
  }
}
