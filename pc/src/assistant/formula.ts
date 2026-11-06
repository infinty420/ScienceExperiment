/**
 * 轻量 LaTeX 子集 → HTML 渲染（自研，避免引入 KaTeX/MathJax/JSPG 等外部依赖）
 * 支持 \frac{}{}、\sqrt{}、^{}、_{}、希腊字母、\times/\cdot/\pm、\sin 等函数名。
 */
export interface FormulaEntry {
  id: string
  name: string
  latex: string
  description: string
  topic: string
}

export const FORMULA_LIBRARY: FormulaEntry[] = [
  { id: 'pendulum', name: '单摆周期', latex: 'T = 2\\pi\\sqrt{\\frac{L}{g}}', description: '小角度近似下的单摆周期；由此可得 g = 4\\pi^2 L / T^2', topic: '力学' },
  { id: 'shm', name: '简谐振动', latex: 'x(t) = A\\cos(\\omega t + \\varphi),\\quad \\omega = \\sqrt{\\frac{k}{m}}', description: '弹簧振子位移随时间变化，角频率由劲度系数与质量决定', topic: '力学' },
  { id: 'ohm', name: '欧姆定律', latex: 'U = IR', description: '导体两端电压与电流成正比，I–U 图斜率为 1/R', topic: '电学' },
  { id: 'mna', name: '节点电流定律', latex: '\\sum_{k} I_k = 0', description: 'MNA 改进节点分析的基础：每个节点流出电流代数和为零', topic: '电学' },
  { id: 'freefall', name: '自由落体', latex: 'y(t) = y_0 - \\frac{1}{2}gt^2', description: '匀加速直线运动，v–t 图斜率即重力加速度', topic: '力学' },
  { id: 'gum', name: '不确定度传播', latex: 'u_c^2(y) = \\sum_i \\left(\\frac{\\partial f}{\\partial x_i}\\right)^2 u^2(x_i)', description: 'GUM 一阶传播律，忽略输入量相关性时的合成标准不确定度', topic: '数据处理' },
  { id: 'gauss', name: '高斯分布', latex: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}', description: '随机误差的经典模型，仪器读数噪声按此分布采样', topic: '数据处理' },
  { id: 'michaelis', name: '米氏方程', latex: 'v = \\frac{V_{max}[S]}{K_m + [S]}', description: '酶促反应速率与底物浓度的饱和关系', topic: '生物化学' },
  { id: 'rlc', name: 'RLC 谐振频率', latex: 'f_0 = \\frac{1}{2\\pi\\sqrt{LC}}', description: '串联 RLC 电路电流最大的频率', topic: '电学' },
  { id: 'snell', name: '折射定律', latex: 'n_1\\sin\\theta_1 = n_2\\sin\\theta_2', description: '光在两种介质界面的折射关系，可推出全反射临界角', topic: '光学' }
]

const GREEK: Record<string, string> = {
  pi: 'π', theta: 'θ', varphi: 'φ', omega: 'ω', mu: 'μ', sigma: 'σ', alpha: 'α', beta: 'β',
  gamma: 'γ', delta: 'δ', lambda: 'λ', rho: 'ρ', tau: 'τ', epsilon: 'ε', Omega: 'Ω', Delta: 'Δ'
}
const SYMBOL: Record<string, string> = {
  times: '×', cdot: '·', pm: '±', leq: '≤', geq: '≥', neq: '≠', approx: '≈',
  infty: '∞', sqrt: '√', sum: '∑', int: '∫', partial: '∂', quad: ' ', left: '', right: ''
}
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'max', 'min', 'lim'])

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** 从位置 i 读取一个分组：{...} 或单个字符/命令 */
function readGroup(src: string, i: number): { content: string; next: number } {
  if (src[i] === '{') {
    let depth = 1
    let j = i + 1
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') depth--
      j++
    }
    return { content: src.slice(i + 1, j - 1), next: j }
  }
  if (src[i] === '\\') {
    const m = /^\\([A-Za-z]+)/.exec(src.slice(i))
    if (m) return { content: `\\${m[1]}`, next: i + m[0].length }
  }
  return { content: src[i] ?? '', next: i + 1 }
}

export function renderLatex(latex: string): string {
  const parse = (src: string): string => {
    let out = ''
    let i = 0
    while (i < src.length) {
      const c = src[i]
      if (c === '\\') {
        const m = /^\\([A-Za-z]+)/.exec(src.slice(i))
        if (!m) { out += escapeHtml(c); i++; continue }
        const cmd = m[1]
        i += m[0].length
        if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
          const a = readGroup(src, i); i = a.next
          const b = readGroup(src, i); i = b.next
          out += `<span class="frac"><span>${parse(a.content)}</span><span>${parse(b.content)}</span></span>`
        } else if (cmd === 'sqrt') {
          const a = readGroup(src, i); i = a.next
          out += `<span class="sqrt">√<span>${parse(a.content)}</span></span>`
        } else if (GREEK[cmd]) out += GREEK[cmd]
        else if (cmd in SYMBOL) out += SYMBOL[cmd]
        else if (FUNCTIONS.has(cmd)) out += `<i>${cmd}</i>`
        else out += escapeHtml(cmd)
        continue
      }
      if (c === '^' || c === '_') {
        const a = readGroup(src, i + 1); i = a.next
        out += c === '^' ? `<sup>${parse(a.content)}</sup>` : `<sub>${parse(a.content)}</sub>`
        continue
      }
      if (c === '{' || c === '}') { i++; continue }
      out += escapeHtml(c)
      i++
    }
    return out
  }
  return `<span class="formula">${parse(latex.replace(/\\left|\\right/g, ''))}</span>`
}

export const FORMULA_CSS = `.formula{font-family:"Cambria Math","Times New Roman",serif;font-size:1.05em;white-space:nowrap}
.formula .frac{display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;margin:0 .15em}
.formula .frac>span:first-child{border-bottom:1px solid currentColor;padding:0 .25em}
.formula .frac>span:last-child{padding:0 .25em}
.formula .sqrt>span{border-top:1px solid currentColor;padding:0 .15em}
.formula sup,.formula sub{font-size:.75em}`

export function findFormula(query: string): FormulaEntry | undefined {
  const q = query.toLowerCase()
  return FORMULA_LIBRARY.find((f) => q.includes(f.name) || f.topic.includes(query) || q.includes(f.id))
}
