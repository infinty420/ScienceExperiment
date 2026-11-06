/**
 * 零依赖测试运行器：
 * 已有 esbuild（vite 的依赖）把 TS 测试打包成 ESM，再用 Node 内置 node:test 执行。
 * 不引入 vitest/jest，避免新增许可证义务与网络安装。
 */
import { build } from 'esbuild'
import { readdirSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const pcRoot = resolve(here, '..')
const testsDir = join(pcRoot, 'tests')
const outDir = resolve(pcRoot, '../.workbuddy/tmp/test-build')

const entries = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => join(testsDir, f))

if (entries.length === 0) {
  console.error('没有找到 tests/*.test.ts')
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: entries,
  outdir: outDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
  sourcemap: false
})

const built = readdirSync(outDir).filter((f) => f.endsWith('.mjs')).map((f) => join(outDir, f))
console.log(`[test] ${built.length} 个测试文件 → node --test`)
const result = spawnSync(process.execPath, ['--test', ...built], { stdio: 'inherit' })
process.exit(result.status ?? 1)
