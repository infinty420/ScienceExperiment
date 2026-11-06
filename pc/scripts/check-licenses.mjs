#!/usr/bin/env node
/**
 * 依赖许可证巡检（零依赖，Node >= 18）——合规红线的自动化守门。
 *
 * 用法：
 *   node scripts/check-licenses.mjs                # 摘要 + 禁止/待复核明细
 *   node scripts/check-licenses.mjs --all          # 打印全部依赖
 *   node scripts/check-licenses.mjs --strict       # 待复核项也视为失败
 *   node scripts/check-licenses.mjs --json out.json
 *
 * 检查三件事：
 *   1. package-lock.json 中每个包的 SPDX 许可证，按允许/禁止/待复核分级
 *   2. 源码里是否直接 import 了未在 package.json 声明的包（隐式依赖风险）
 *   3. 直接依赖与传递依赖分别统计，输出可留档的依赖许可清单
 *
 * 判定原则：GPL/AGPL/LGPL/SSPL/EUPL/CeCILL/MPL/EPL/CC-BY-NC 等一律禁止；
 * 缺少或无法识别的许可证一律「待复核」，绝不默认可用。
 */
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const pcRoot = resolve(here, '..')
const args = parseArgs(process.argv.slice(2))

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      out[key] = next && !next.startsWith('--') ? next : 'true'
      if (out[key] === next) i++
    }
  }
  return out
}

const ALLOW = new Set([
  'MIT', 'APACHE-2.0', 'BSD-2-CLAUSE', 'BSD-3-CLAUSE', 'BSD-3-CLAUSE-CLEAR',
  'ISC', '0BSD', 'ZLIB', 'UNLICENSE', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0',
  'PYTHON-2.0', 'BLUEOAK-1.0.0', 'BSL-1.0', 'WTFPL', 'MIT-0', 'X11'
].map((s) => s.toUpperCase()))

const DENY = [
  /^GPL/i, /^AGPL/i, /^LGPL/i, /^SSPL/i, /^EUPL/i, /^CECILL/i,
  /^MPL/i, /^EPL/i, /^CDDL/i, /^CC-BY-(NC|SA)/i, /^OSL/i, /^QPL/i,
  /^RPL/i, /^BUSL/i, /^ELASTIC/i, /COMMONS[- ]CLAUSE/i
]

const REVIEW_WORDS = /^(NOASSERTION|UNLICENSED|SEE LICENSE IN|UNKNOWN|NONE|PROPRIETARY)$/i

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

function licenseText(v) {
  if (typeof v === 'string') return v.trim()
  if (v && typeof v === 'object') {
    if (typeof v.type === 'string') return v.type.trim()
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x?.type ?? '')).join(' OR ')
  }
  return ''
}

function tokens(expr) {
  return expr.replace(/[()]/g, ' ').split(/\s+(?:OR|AND|WITH)\s+/i).map((s) => s.trim()).filter(Boolean)
}

/** 从 LICENSE 正文头部推断宽松许可（仅用于 SEE LICENSE IN 的兜底） */
function guessFromText(text) {
  const t = text.slice(0, 4000)
  if (/Permission is hereby granted, free of charge/i.test(t)) return 'MIT'
  if (/Apache License\s+Version 2\.0/i.test(t)) return 'Apache-2.0'
  if (/Redistribution and use in source and binary forms/i.test(t)) return 'BSD-3-Clause'
  if (/The ISC License/i.test(t)) return 'ISC'
  return ''
}

function classify(raw, lockPath) {
  const expr = licenseText(raw)
  if (!expr) return { level: 'review', reason: '缺少 license 字段' }
  if (/^SEE LICENSE IN/i.test(expr)) {
    const file = expr.replace(/^SEE LICENSE IN\s+/i, '').trim().replace(/[.]?$/, '')
    const candidate = join(pcRoot, lockPath, file)
    if (existsSync(candidate)) {
      const guessed = guessFromText(readFileSync(candidate, 'utf8'))
      if (guessed) return { level: 'allow', spdx: guessed, reason: `由 ${file} 推断` }
    }
    return { level: 'review', spdx: expr, reason: '需人工核对 LICENSE 正文' }
  }
  const parts = tokens(expr)
  if (parts.some((p) => DENY.some((re) => re.test(p)))) {
    return { level: 'deny', spdx: expr, reason: '含 Copyleft / 使用限制条款' }
  }
  if (parts.some((p) => REVIEW_WORDS.test(p))) {
    return { level: 'review', spdx: expr, reason: '授权不明，不得默认可用' }
  }
  if (parts.length && parts.every((p) => ALLOW.has(p.toUpperCase()))) {
    return { level: 'allow', spdx: expr, reason: '' }
  }
  return { level: 'review', spdx: expr, reason: '未收录的 SPDX 标识，需人工核对' }
}

/* ── 1. 依赖许可清单 ── */
const pkg = readJSON(join(pcRoot, 'package.json')) ?? {}
const lock = readJSON(join(pcRoot, 'package-lock.json'))
if (!lock || !lock.packages || lock.lockfileVersion !== 3) {
  console.error('[licenses] 需要 package-lock.json (lockfileVersion 3)，请先执行 npm install')
  process.exit(1)
}

const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {})
])
const runtimeDeclared = new Set(Object.keys(pkg.dependencies ?? {}))

const rows = []
for (const [lockPath, meta] of Object.entries(lock.packages)) {
  if (!lockPath) continue
  const name = lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length)
  const verdict = classify(meta.license ?? meta.licenses, lockPath)
  rows.push({
    name,
    version: meta.version ?? '—',
    license: verdict.spdx ?? licenseText(meta.license ?? meta.licenses) ?? '—',
    level: verdict.level,
    reason: verdict.reason,
    scope: runtimeDeclared.has(name) ? 'runtime' : declared.has(name) ? 'dev' : 'transitive',
    dev: meta.dev === true || meta.optional === true
  })
}
rows.sort((a, b) => a.name.localeCompare(b.name))

/* ── 2. 隐式直接导入检查 ── */
const SOURCE_DIRS = ['scripts', 'src', 'tests']
const EXTS = new Set(['.ts', '.mjs', '.js', '.vue'])
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]))
const importFiles = []
function walk(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (EXTS.has(entry.name.slice(entry.name.lastIndexOf('.')))) importFiles.push(p)
  }
}
for (const d of SOURCE_DIRS) walk(join(pcRoot, d))

const IMPORT_RE = /(?:import|export)[^;]*?\sfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/gm
const used = new Map()
for (const file of importFiles) {
  const text = readFileSync(file, 'utf8')
  let m
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(text)) !== null) {
    const spec = m[1] ?? m[2] ?? m[3]
    if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) continue
    if (builtins.has(spec) || spec.startsWith('node:')) continue
    const bare = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    if (!used.has(bare)) used.set(bare, new Set())
    used.get(bare).add(relative(pcRoot, file))
  }
}
const undeclared = [...used.entries()]
  .filter(([bare]) => !declared.has(bare))
  .map(([bare, files]) => ({ bare, files: [...files] }))

/* ── 3. 输出 ── */
const counts = { allow: 0, deny: 0, review: 0 }
for (const r of rows) counts[r.level]++
const denied = rows.filter((r) => r.level === 'deny')
const reviews = rows.filter((r) => r.level === 'review')

if (args.all === 'true' || args.all) {
  for (const r of rows) {
    console.log(`${r.level.toUpperCase().padEnd(6)} ${r.name.padEnd(34)} ${String(r.version).padEnd(14)} ${r.scope.padEnd(10)} ${r.license}`)
  }
}
for (const r of denied) console.error(`[DENY ] ${r.name}@${r.version} ${r.license} — ${r.reason}`)
for (const r of reviews) console.warn(`[REVIEW] ${r.name}@${r.version} ${r.license} — ${r.reason}`)
for (const u of undeclared) {
  console.warn(`[IMPLICIT] 源码直接导入了未声明的包 "${u.bare}"：${u.files.join(', ')}`)
}

const spdxSummary = {}
for (const r of rows) spdxSummary[r.license] = (spdxSummary[r.license] ?? 0) + 1
console.log(`[licenses] ${rows.length} 个依赖：允许 ${counts.allow} / 禁止 ${counts.deny} / 待复核 ${counts.review}；隐式导入 ${undeclared.length} 个`)
console.log(`[licenses] SPDX 分布：${JSON.stringify(spdxSummary)}`)
console.log('[licenses] 红线：GPL/AGPL/LGPL/SSPL/EUPL/CeCILL/MPL/EPL/CC-BY-NC 等禁止；授权不明一律待复核')

if (args.json && args.json !== 'true') {
  const out = { generatedAt: new Date().toISOString(), counts, undeclared, rows, spdxSummary }
  writeFileSync(resolve(args.json), JSON.stringify(out, null, 2), 'utf8')
  console.log(`[licenses] 清单已写入 ${resolve(args.json)}`)
}

const strict = args.strict === 'true' || args.strict === true
const failed = counts.deny > 0 || undeclared.length > 0 || (strict && counts.review > 0)
if (failed) console.error('[licenses] 巡检未通过：请先消除禁止项 / 隐式导入 / 待复核项')
process.exit(failed ? 1 : 0)
