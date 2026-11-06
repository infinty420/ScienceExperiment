#!/usr/bin/env node
/**
 * GitHub 相似项目检索与许可证全文取证（零依赖，Node >= 18）。
 *
 * 用法：
 *   node gh_license_audit.mjs --queries queries.txt --repos repos.txt --out ./audit
 *   node gh_license_audit.mjs --repos repos.txt --readme owner/repo:main --out ./audit
 *
 * 认证：可选环境变量 GITHUB_TOKEN（仅用于提高 API 限流额度，不写入产物）。
 * 说明：本脚本只取证元数据与 LICENSE / README 文本，不下载、不复制任何源码。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const API = 'https://api.github.com'
const args = parseArgs(process.argv.slice(2))
const outDir = resolve(args.out ?? './audit')
mkdirSync(join(outDir, 'licenses'), { recursive: true })
mkdirSync(join(outDir, 'readmes'), { recursive: true })

const DEFAULT_QUERIES = [
  'virtual physics lab simulation education',
  'interactive physics simulation javascript',
  'physics engine simulation open source',
  'circuit simulator javascript SPICE',
  'virtual chemistry laboratory simulation',
  'experiment data curve fitting analysis education',
  'spaced repetition learning algorithm',
  'knowledge tracing mastery learning open source',
  'lab report learning analytics open source'
]

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

function readLines(file, fallback = []) {
  if (!file || !existsSync(file)) return fallback
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'))
}

function headers() {
  const h = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'compliant-lab-upgrade-audit/1.0',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return h
}

async function api(path) {
  try {
    const res = await fetch(`${API}${path}`, { headers: headers() })
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` }
    return { ok: true, data: await res.json() }
  } catch (e) {
    return { ok: false, status: 0, error: String(e && e.message ? e.message : e) }
  }
}

function decodeContent(payload) {
  if (!payload || !payload.content) return ''
  try {
    return Buffer.from(payload.content, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

function safeName(fullName) {
  return fullName.replace(/[^A-Za-z0-9._-]/g, '_')
}

const audit = {
  generatedAt: new Date().toISOString(),
  queries: [],
  candidates: [],
  repos: [],
  licenseTexts: [],
  readmeTexts: [],
  errors: [],
  note: 'NOASSERTION / 403 / 拉取失败的条目必须人工交叉验证官方来源，不得据此认定可自由使用。'
}

const queries = readLines(args.queries, DEFAULT_QUERIES)
const repos = readLines(args.repos, [])
const readmeTargets = (args.readme && args.readme !== 'true' ? args.readme : '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [full, branch] = s.split(':')
    return { full, branch: branch || 'main' }
  })

// 1. 广域检索：只收集元数据，遇限流如实记录，不重试绕过
for (const q of queries) {
  const r = await api(`/search/repositories?q=${encodeURIComponent(q)}&per_page=30&sort=stars`)
  audit.queries.push({ q, ok: r.ok, status: r.status ?? null, count: r.ok ? (r.data.items ?? []).length : 0 })
  if (!r.ok) {
    audit.errors.push({ stage: 'search', q, error: r.error })
    console.warn(`[WARN] 检索失败（已记录）: ${q} -> ${r.error}`)
    continue
  }
  for (const item of r.data.items ?? []) {
    audit.candidates.push({
      full_name: item.full_name,
      html_url: item.html_url,
      stars: item.stargazers_count,
      description: item.description ?? '',
      license: item.license?.spdx_id ?? 'NOASSERTION'
    })
  }
}
const seen = new Set()
audit.candidates = audit.candidates.filter((c) => {
  if (seen.has(c.full_name)) return false
  seen.add(c.full_name)
  return true
})

// 2. 精确核查：未显式给 repos.txt 时，取候选池中 stars 最高的 25 个
const targets = repos.length
  ? repos
  : [...audit.candidates].sort((a, b) => b.stars - a.stars).slice(0, 25).map((c) => c.full_name)

for (const full of targets) {
  const meta = await api(`/repos/${full}`)
  if (!meta.ok) {
    audit.errors.push({ stage: 'repo', full, error: meta.error })
    console.warn(`[WARN] 元数据失败（已记录）: ${full} -> ${meta.error}`)
    continue
  }
  const d = meta.data
  const entry = {
    full_name: d.full_name,
    html_url: d.html_url,
    default_branch: d.default_branch,
    stars: d.stargazers_count,
    topics: d.topics ?? [],
    spdx: d.license?.spdx_id ?? 'NOASSERTION',
    license_name: d.license?.name ?? null,
    license_key: d.license?.key ?? null,
    archived: d.archived,
    description: d.description ?? ''
  }

  const lic = await api(`/repos/${full}/license`)
  if (lic.ok && lic.data.content) {
    const text = decodeContent(lic.data)
    const file = `${safeName(full)}.txt`
    writeFileSync(join(outDir, 'licenses', file), text, 'utf8')
    entry.licenseFile = `licenses/${file}`
    entry.licenseBytes = Buffer.byteLength(text)
    audit.licenseTexts.push(full)
  } else {
    entry.licenseIssue = lic.ok ? 'API 无 license 正文' : lic.error
    audit.errors.push({ stage: 'license', full, error: entry.licenseIssue })
  }
  audit.repos.push(entry)
}

// 3. 可选：抓取 README 作为架构思路参考（只存文本，不复制源码）
for (const t of readmeTargets) {
  const rm = await api(`/repos/${t.full}/readme`)
  if (!rm.ok) {
    audit.errors.push({ stage: 'readme', full: t.full, error: rm.error })
    continue
  }
  const text = decodeContent(rm.data)
  const file = `${safeName(t.full)}.md`
  writeFileSync(join(outDir, 'readmes', file), text, 'utf8')
  audit.readmeTexts.push({ full: t.full, file: `readmes/${file}`, branch: t.branch })
}

writeFileSync(join(outDir, 'audit.json'), JSON.stringify(audit, null, 2), 'utf8')

const spdx = {}
for (const r of audit.repos) spdx[r.spdx] = (spdx[r.spdx] ?? 0) + 1
console.log(`[audit] 候选 ${audit.candidates.length} 个 / 精确核查 ${audit.repos.length} 个 / LICENSE 全文 ${audit.licenseTexts.length} 份`)
console.log(`[audit] SPDX 分布: ${JSON.stringify(spdx)}`)
console.log(`[audit] 失败 ${audit.errors.length} 条（详见 ${join(outDir, 'audit.json')}）`)
if (audit.errors.length) console.log('[audit] 提醒：403 限流与 NOASSERTION 需人工交叉验证官方来源，不得据此认定可自由使用。')
