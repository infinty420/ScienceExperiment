#!/usr/bin/env node
/**
 * 技能包结构自检（零依赖，Node >= 18）。
 *
 * 用法：node scripts/validate_skill.mjs [技能包目录]，默认当前目录。
 * 检查：YAML frontmatter、manifest 字段、目录结构、清单文件一致性、SKILL.md 行数、脚本语法。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(process.argv[2] ?? '.')
const problems = []
const notes = []
const ok = (msg) => notes.push(msg)
const bad = (msg) => problems.push(msg)

if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`[skill] 目录不存在: ${root}`)
  process.exit(1)
}

// 1. SKILL.md 与 frontmatter
const skillPath = join(root, 'SKILL.md')
if (!existsSync(skillPath)) {
  bad('缺少 SKILL.md')
} else {
  const text = readFileSync(skillPath, 'utf8')
  const lines = text.split(/\r?\n/)
  if (lines.length > 500) bad(`SKILL.md 有 ${lines.length} 行，超过 500 行上限（应做渐进式披露）`)
  else ok(`SKILL.md ${lines.length} 行，符合 <500 行`)
  if (!text.startsWith('---')) {
    bad('SKILL.md 缺少 YAML frontmatter 起始标记 ---')
  } else {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
    if (end < 0) bad('YAML frontmatter 未闭合')
    else {
      const fm = lines.slice(1, end).join('\n')
      if (!/^name:\s*\S+/m.test(fm)) bad('frontmatter 缺少 name')
      if (!/^description:\s*\S+/m.test(fm)) bad('frontmatter 缺少 description')
      const desc = (fm.match(/^description:\s*(.+)$/m) ?? [])[1] ?? ''
      if (desc.length < 40) bad('description 过短，需包含「何时使用」触发场景')
      else ok(`description ${desc.length} 字符，含触发描述`)
      const name = (fm.match(/^name:\s*(\S+)/m) ?? [])[1] ?? ''
      if (name && !/^[a-z0-9-]+$/.test(name)) bad(`name 必须小写字母/数字/连字符: ${name}`)
    }
  }
}

// 2. manifest.json
let manifest = null
const manifestPath = join(root, 'manifest.json')
if (!existsSync(manifestPath)) {
  bad('缺少 manifest.json')
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    ok('manifest.json 可解析')
  } catch (e) {
    bad(`manifest.json 解析失败: ${e.message}`)
  }
  if (manifest) {
    for (const k of ['name', 'version', 'description', 'author', 'entry', 'tags', 'license']) {
      if (!(k in manifest)) bad(`manifest 缺少字段 ${k}`)
    }
    if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) bad(`version 非语义化版本: ${manifest.version}`)
    if (manifest.tags && !Array.isArray(manifest.tags)) bad('tags 必须是数组')
    if (manifest.entry && !existsSync(join(root, manifest.entry))) bad(`entry 指向的文件不存在: ${manifest.entry}`)
    if (manifest.name && manifest.contents?.scripts) {
      const fm = existsSync(skillPath) ? readFileSync(skillPath, 'utf8') : ''
      const fmName = (fm.match(/^name:\s*(\S+)/m) ?? [])[1] ?? ''
      if (fmName && fmName !== manifest.name) bad(`SKILL.md name (${fmName}) 与 manifest.name (${manifest.name}) 不一致`)
    }
  }
}

// 3. 目录结构与清单一致性
for (const dir of ['scripts', 'references', 'assets']) {
  const p = join(root, dir)
  if (!existsSync(p) || !statSync(p).isDirectory()) bad(`缺少目录 ${dir}/`)
  else {
    const files = readdirSync(p).filter((f) => statSync(join(p, f)).isFile())
    if (!files.length) bad(`目录 ${dir}/ 为空`)
    else ok(`${dir}/ 含 ${files.length} 个文件`)
  }
}
if (manifest?.contents) {
  for (const [group, list] of Object.entries(manifest.contents)) {
    if (!Array.isArray(list)) { bad(`manifest.contents.${group} 必须是数组`); continue }
    for (const rel of list) {
      if (!existsSync(join(root, rel))) bad(`manifest 清单中的文件不存在: ${rel}`)
    }
  }
  ok('manifest.contents 清单已核对')
}

// 4. 脚本语法：用 node --check 静态检查，绝不执行脚本顶层代码（避免网络请求 / process.exit 等副作用）
if (existsSync(join(root, 'scripts'))) {
  for (const f of readdirSync(join(root, 'scripts')).filter((f) => f.endsWith('.mjs') || f.endsWith('.js'))) {
    const p = join(root, 'scripts', f)
    const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' })
    if (r.status !== 0) bad(`scripts/${f} 语法错误: ${(r.stderr || '').trim().split(/\r?\n/)[0]}`)
  }
  ok('scripts 静态语法预检完成（node --check，未执行任何副作用）')
}

for (const n of notes) console.log(`[ OK ] ${n}`)
for (const p of problems) console.error(`[FAIL] ${p}`)
console.log(`[skill] ${problems.length} 项不合格，${notes.length} 项通过`)
process.exit(problems.length ? 1 : 0)
