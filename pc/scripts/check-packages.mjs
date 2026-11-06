/**
 * 独立实验包体检：不依赖测试框架，直接校验 experiments/<id>/scene.json 与 quiz.json。
 * 供 CI 与本地发布前检查使用（零额外依赖，复用已有 esbuild）。
 */
import { build } from 'esbuild'
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pcRoot = resolve(here, '..')
const experimentsDir = join(pcRoot, 'experiments')
const tmp = mkdtempSync(join(tmpdir(), 'scilab-validate-'))
const entry = join(tmp, 'validate.mjs')

await build({
  entryPoints: [join(pcRoot, 'src/experiments/validate.ts')],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent'
})
const { validateScene, validateQuiz, formatIssues } = await import(pathToFileURL(entry).href)

const dirs = readdirSync(experimentsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
let errors = 0
let warnings = 0
let quizzes = 0
for (const dir of dirs) {
  const scene = JSON.parse(readFileSync(join(experimentsDir, dir, 'scene.json'), 'utf8'))
  const r = validateScene(scene)
  errors += r.errors
  warnings += r.warnings
  if (r.errors) console.error(`[ERROR] ${dir}\n${formatIssues(r, 8)}`)
  try {
    const quiz = JSON.parse(readFileSync(join(experimentsDir, dir, 'quiz.json'), 'utf8'))
    quizzes++
    const qr = validateQuiz(quiz)
    errors += qr.errors
    warnings += qr.warnings
    if (qr.errors) console.error(`[ERROR] ${dir}/quiz.json\n${formatIssues(qr, 8)}`)
  } catch { /* 无题库 */ }
}
rmSync(tmp, { recursive: true, force: true })
console.log(`[packages] ${dirs.length} 个实验包 + ${quizzes} 个题库：${errors} 个错误，${warnings} 条提示`)
process.exit(errors ? 1 : 0)
