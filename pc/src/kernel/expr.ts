/**
 * 安全表达式内核（纯 TS，零依赖）
 *
 * Tokenizer + Pratt 解析器 + 闭包编译。禁止 eval / new Function，
 * 用于 DSL v2 中可声明的动力学方程、拟合模型与评分规则。
 * 支持：+ - * / ^、一元负号、括号、变量、常量与白名单数学函数。
 */
export type ExprNode =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'un'; op: string; arg: ExprNode }
  | { type: 'bin'; op: string; left: ExprNode; right: ExprNode }
  | { type: 'call'; name: string; args: ExprNode[] }

type Token = { kind: 'num' | 'ident' | 'op' | '(' | ')' | ',' | 'eof'; text: string; pos: number }

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  tau: 2 * Math.PI,
  g: 9.80665,
  c: 299792458,
  h: 6.62607015e-34,
  kB: 1.380649e-23,
  NA: 6.02214076e23,
  R: 8.314462618,
  eps: Number.EPSILON
}

type Fn = (...args: number[]) => number
const FUNCTIONS: Record<string, Fn> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: (x) => Math.sqrt(x), abs: (x) => Math.abs(x),
  exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10, log2: Math.log2,
  pow: (a, b) => Math.pow(a, b), hypot: Math.hypot,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
  step: (x) => (x >= 0 ? 1 : 0),
  sinc: (x) => (Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x)
}

function tokenize(src: string): Token[] {
  if (src.length > 4096) throw new Error('表达式过长（上限 4096 字符）')
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))
      if (!m) throw new Error(`位置 ${i}: 非法数字`)
      out.push({ kind: 'num', text: m[0], pos: i })
      i += m[0].length
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!
      out.push({ kind: 'ident', text: m[0], pos: i })
      i += m[0].length
      continue
    }
    if ('+-*/^'.includes(ch)) { out.push({ kind: 'op', text: ch, pos: i }); i++; continue }
    if (ch === '(') { out.push({ kind: '(', text: ch, pos: i }); i++; continue }
    if (ch === ')') { out.push({ kind: ')', text: ch, pos: i }); i++; continue }
    if (ch === ',') { out.push({ kind: ',', text: ch, pos: i }); i++; continue }
    throw new Error(`位置 ${i}: 非法字符 ${ch}`)
  }
  out.push({ kind: 'eof', text: '', pos: src.length })
  return out
}

const PRECEDENCE: Record<string, number> = { '+': 10, '-': 10, '*': 20, '/': 20, '^': 30 }

class Parser {
  private i = 0
  private nodes = 0
  constructor(private readonly tokens: Token[]) {}

  parse(): ExprNode {
    const node = this.parseExpr(0)
    if (this.peek().kind !== 'eof') throw new Error(`位置 ${this.peek().pos}: 多余内容 ${this.peek().text}`)
    return node
  }

  private peek(): Token { return this.tokens[this.i] }
  private take(): Token { return this.tokens[this.i++] }
  private bump(): void {
    this.nodes++
    if (this.nodes > 2000) throw new Error('表达式节点过多')
  }

  private parseExpr(minBp: number): ExprNode {
    let left = this.parsePrefix()
    for (;;) {
      const t = this.peek()
      if (t.kind !== 'op') break
      const bp = PRECEDENCE[t.text] ?? 0
      if (bp < minBp || bp === 0) break
      this.take()
      // ^ 右结合：右操作数的最小绑定优先级为 bp（其余为 bp+1）
      const right = this.parseExpr(t.text === '^' ? bp : bp + 1)
      this.bump()
      left = { type: 'bin', op: t.text, left, right }
    }
    return left
  }

  private parsePrefix(): ExprNode {
    const t = this.take()
    if (t.kind === 'num') { this.bump(); return { type: 'num', value: Number(t.text) } }
    if (t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      const arg = this.parseExpr(25)
      this.bump()
      return t.text === '-' ? { type: 'un', op: '-', arg } : arg
    }
    if (t.kind === '(') {
      const inner = this.parseExpr(0)
      if (this.peek().kind !== ')') throw new Error(`位置 ${this.peek().pos}: 缺少右括号`)
      this.take()
      return inner
    }
    if (t.kind === 'ident') {
      if (this.peek().kind === '(') {
        this.take()
        const args: ExprNode[] = []
        if (this.peek().kind !== ')') {
          for (;;) {
            args.push(this.parseExpr(0))
            if (this.peek().kind === ',') { this.take(); continue }
            break
          }
        }
        if (this.peek().kind !== ')') throw new Error(`位置 ${this.peek().pos}: 函数 ${t.text} 缺少右括号`)
        this.take()
        const fn = t.text.toLowerCase()
        if (!FUNCTIONS[fn]) throw new Error(`位置 ${t.pos}: 未知函数 ${t.text}`)
        this.bump()
        return { type: 'call', name: fn, args }
      }
      // 常量作为「可被变量覆盖的默认值」：公式里的 R/c/g 既可当物理常数，
      // 也可由实验参数显式给定（否则会静默遮蔽参数导致数量级错误）。
      this.bump()
      return { type: 'var', name: t.text }
    }
    throw new Error(`位置 ${t.pos}: 意外的记号 ${t.text || 'EOF'}`)
  }
}

export function parseExpression(src: string): ExprNode {
  return new Parser(tokenize(src)).parse()
}

function collectVariables(node: ExprNode, out: Set<string>): void {
  switch (node.type) {
    case 'var':
      // 物理常数是可覆盖默认值，不算「缺失的输入变量」
      if (!Object.prototype.hasOwnProperty.call(CONSTANTS, node.name)) out.add(node.name)
      break
    case 'un': collectVariables(node.arg, out); break
    case 'bin': collectVariables(node.left, out); collectVariables(node.right, out); break
    case 'call': node.args.forEach((a) => collectVariables(a, out)); break
    default: break
  }
}

type Evaluator = (vars: Record<string, number>) => number

function compileNode(node: ExprNode): Evaluator {
  switch (node.type) {
    case 'num': { const v = node.value; return () => v }
    case 'var': {
      const n = node.name
      const fallback = Object.prototype.hasOwnProperty.call(CONSTANTS, n) ? CONSTANTS[n] : NaN
      return (vars) => {
        const v = vars[n]
        return typeof v === 'number' && Number.isFinite(v) ? v : fallback
      }
    }
    case 'un': { const f = compileNode(node.arg); return (vars) => -f(vars) }
    case 'bin': {
      const l = compileNode(node.left)
      const r = compileNode(node.right)
      switch (node.op) {
        case '+': return (v) => l(v) + r(v)
        case '-': return (v) => l(v) - r(v)
        case '*': return (v) => l(v) * r(v)
        case '/': return (v) => l(v) / r(v)
        case '^': return (v) => Math.pow(l(v), r(v))
        default: return () => NaN
      }
    }
    case 'call': {
      const fn = FUNCTIONS[node.name]
      const args = node.args.map(compileNode)
      return (vars) => fn(...args.map((a) => a(vars)))
    }
  }
}

export interface CompiledExpression {
  source: string
  variables: string[]
  evaluate: (vars?: Record<string, number>) => number
  ast: ExprNode
}

const cache = new Map<string, CompiledExpression>()

export function compile(src: string): CompiledExpression {
  const cached = cache.get(src)
  if (cached) return cached
  const ast = parseExpression(src)
  const vars = new Set<string>()
  collectVariables(ast, vars)
  const evaluate = compileNode(ast)
  const result: CompiledExpression = {
    source: src,
    variables: [...vars],
    evaluate: (v) => evaluate(v ?? {}),
    ast
  }
  if (cache.size < 512) cache.set(src, result)
  return result
}

export function evaluate(src: string, vars: Record<string, number> = {}): number {
  return compile(src).evaluate(vars)
}

export function validateExpression(src: string): { ok: boolean; error?: string; variables?: string[] } {
  try {
    const c = compile(src)
    return { ok: true, variables: c.variables }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 把多个公式编译成 ODE 右端函数（y 为状态向量，键名 y0..yN-1 与别名数组对应） */
export function compileSystem(equations: string[], stateNames: string[], paramNames: string[] = []): {
  derivative: (t: number, y: number[], params: Record<string, number>) => number[]
  variables: string[]
} {
  const compiled = equations.map(compile)
  void paramNames
  return {
    variables: [...new Set(compiled.flatMap((c) => c.variables))],
    derivative: (t, y, params) => {
      const vars: Record<string, number> = { t, ...params }
      stateNames.forEach((n, i) => { vars[n] = y[i] })
      y.forEach((v, i) => { vars[`y${i}`] = v })
      return compiled.map((c) => c.evaluate(vars))
    }
  }
}
