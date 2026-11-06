/**
 * 离线检索增强：BM25（中文二元字 gram + 英文词元），零依赖
 * 让 AI 助教在完全离线的桌面/鸿蒙 WebView 中也能基于实验文档回答问题。
 */
export interface Doc {
  id: string
  title: string
  body: string
  tags?: string[]
}
export interface IndexedDoc extends Doc {
  tokens: string[]
  length: number
  tf: Map<string, number>
}
export interface BM25Index {
  docs: IndexedDoc[]
  df: Map<string, number>
  avgdl: number
}
export interface SearchHit {
  doc: Doc
  score: number
}

const STOP = new Set(['的', '了', '和', '与', '是', '在', '有', '为', '如何', '什么', 'the', 'a', 'an', 'is', 'of', 'to', 'and'])

/** 中文按二元字切分，英文/数字按词元切分 */
export function tokenize(text: string): string[] {
  const out: string[] = []
  const lower = text.toLowerCase()
  const re = /[\u4e00-\u9fff]+|[a-z][a-z0-9_]*|\d+(?:\.\d+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(lower)) !== null) {
    const t = m[0]
    if (/[\u4e00-\u9fff]/.test(t)) {
      if (t.length === 1) out.push(t)
      for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2))
    } else if (!STOP.has(t)) {
      out.push(t)
    }
  }
  return out
}

export function buildIndex(docs: Doc[]): BM25Index {
  const indexed: IndexedDoc[] = docs.map((d) => {
    const tokens = tokenize(`${d.title} ${d.title} ${d.body} ${(d.tags ?? []).join(' ')}`)
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    return { ...d, tokens, tf, length: tokens.length }
  })
  const df = new Map<string, number>()
  for (const d of indexed) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const avgdl = indexed.length ? indexed.reduce((s, d) => s + d.length, 0) / indexed.length : 1
  return { docs: indexed, df, avgdl }
}

export function idf(index: BM25Index, term: string): number {
  const n = index.docs.length
  const d = index.df.get(term) ?? 0
  return Math.log(1 + (n - d + 0.5) / (d + 0.5))
}

/** BM25 检索；k1=1.5、b=0.75 为经典取值 */
export function search(index: BM25Index, query: string, topK = 3): SearchHit[] {
  const terms = [...new Set(tokenize(query))]
  const k1 = 1.5
  const b = 0.75
  const hits = index.docs.map((doc) => {
    let score = 0
    for (const t of terms) {
      const tf = doc.tf.get(t) ?? 0
      if (!tf) continue
      const norm = tf + k1 * (1 - b + b * doc.length / Math.max(1, index.avgdl))
      score += idf(index, t) * (tf * (k1 + 1)) / norm
    }
    return { doc: { id: doc.id, title: doc.title, body: doc.body, tags: doc.tags }, score }
  })
  return hits.filter((h) => h.score > 0).sort((a, b2) => b2.score - a.score).slice(0, topK)
}

/** 把实验包与公式库整理成可检索文档 */
export function docsFromScenes(scenes: Array<{ id: string; title: string; guide?: string; meta?: { pedagogy?: { objectives?: string[] } } }>): Doc[] {
  return scenes.map((s) => ({
    id: s.id,
    title: s.title,
    body: [s.guide ?? '', (s.meta?.pedagogy?.objectives ?? []).join('；')].filter(Boolean).join('。'),
    tags: [s.id.split('.')[0]]
  }))
}
