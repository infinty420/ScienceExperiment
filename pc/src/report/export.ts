/**
 * 报告 3.0 导出：Markdown / 自包含 HTML（内嵌 SVG 曲线）/ CSV / 快照 JSON
 * 不引入任何图表或 Markdown 库（MIT 项目 uPlot / marked 仅作思路参考）。
 */
import type { LabReport } from './builder'
import type { ExperimentSnapshot } from '../learning/snapshot'
import { serializeSnapshot } from '../learning/snapshot'

export type ExportFormat = 'markdown' | 'html' | 'csv' | 'snapshot'

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** 自绘 SVG 折线图：自动缩放 + min/max 抽稀（参考 uPlot 的公开思路） */
export function svgLineChart(
  rows: number[][],
  xIndex = 0,
  yIndex = 1,
  opts: { width?: number; height?: number; title?: string; color?: string } = {}
): string {
  const w = opts.width ?? 720
  const h = opts.height ?? 260
  const pad = 42
  const color = opts.color ?? '#3f8f79'
  const pts = rows.filter((r) => Number.isFinite(r[xIndex]) && Number.isFinite(r[yIndex]))
  if (pts.length < 2) return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><text x="12" y="24" fill="#64748b">数据点不足，无法绘图</text></svg>`
  const xs = pts.map((r) => r[xIndex])
  const ys = pts.map((r) => r[yIndex])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const sx = (v: number): number => pad + (maxX > minX ? (v - minX) / (maxX - minX) : 0.5) * (w - pad * 2)
  const sy = (v: number): number => h - pad - (maxY > minY ? (v - minY) / (maxY - minY) : 0.5) * (h - pad * 2)
  // 按像素列做 min/max 抽稀，避免高采样率下画出一堆重叠路径
  const buckets = new Map<number, { min: number; max: number }>()
  for (const p of pts) {
    const col = Math.round(sx(p[xIndex]))
    const b = buckets.get(col)
    if (!b) buckets.set(col, { min: p[yIndex], max: p[yIndex] })
    else { b.min = Math.min(b.min, p[yIndex]); b.max = Math.max(b.max, p[yIndex]) }
  }
  const linePts: string[] = []
  for (const p of pts) linePts.push(`${sx(p[xIndex]).toFixed(1)},${sy(p[yIndex]).toFixed(1)}`)
  const spans = [...buckets.entries()].map(([col, b]) =>
    `<line x1="${col}" y1="${sy(b.max).toFixed(1)}" x2="${col}" y2="${sy(b.min).toFixed(1)}" stroke="${color}" stroke-opacity="0.22" stroke-width="1"/>`).join('')
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    `<line x1="${pad}" y1="${(pad + f * (h - pad * 2)).toFixed(1)}" x2="${w - pad}" y2="${(pad + f * (h - pad * 2)).toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`).join('')
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(opts.title ?? '实验曲线')}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${grid}
  <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#94a3b8"/>
  <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="#94a3b8"/>
  ${spans}
  <polyline points="${linePts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
  <text x="${pad}" y="20" font-size="12" fill="#334155">${escapeHtml(opts.title ?? '实验曲线')}</text>
  <text x="${w - pad}" y="${h - 12}" font-size="11" fill="#64748b" text-anchor="end">${maxX.toPrecision(3)}</text>
  <text x="${pad}" y="${h - 12}" font-size="11" fill="#64748b">${minX.toPrecision(3)}</text>
  <text x="6" y="${pad + 4}" font-size="11" fill="#64748b">${maxY.toPrecision(3)}</text>
  <text x="6" y="${h - pad}" font-size="11" fill="#64748b">${minY.toPrecision(3)}</text>
</svg>`
}

export function toMarkdown(r: LabReport): string {
  const lines: string[] = [`# ${r.title} · 实验报告 3.0`, '', `> 实验 ID：${r.experimentId}　学科：${r.subject}　学习者：${r.student}`, `> 生成时间：${new Date(r.createdAt).toLocaleString('zh-CN')}`, '']
  for (const s of r.sections) {
    lines.push(`## ${s.title}`, '')
    for (const p of s.paragraphs) lines.push(p, '')
    if (s.table) {
      lines.push(`| ${s.table.headers.join(' | ')} |`, `| ${s.table.headers.map(() => '---').join(' | ')} |`)
      for (const row of s.table.rows) lines.push(`| ${row.join(' | ')} |`)
      lines.push('')
    }
    if (s.bullets?.length) {
      for (const b of s.bullets) lines.push(`- ${b}`)
      lines.push('')
    }
  }
  if (r.checksum) lines.push('---', '', `快照 SHA-256：\`${r.checksum}\``, '')
  lines.push('---', '', '*本报告由智实验 V3 生成；参考项目的致谢与许可证见「参考与致谢」章节。*')
  return lines.join('\n')
}

export function toHTML(r: LabReport): string {
  const dataSection = r.sections.find((s) => s.key === 'data')
  const rows = dataSection?.table?.rows?.map((row) => row.map(Number)).filter((row) => row.every(Number.isFinite)) ?? []
  const chart = svgLineChart(rows, 0, Math.min(1, Math.max(0, (rows[0]?.length ?? 2) - 1)), { title: `${r.title} · 数据曲线` })
  const body = r.sections.map((s) => {
    const table = s.table
      ? `<table><thead><tr>${s.table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : ''
    const bullets = s.bullets?.length ? `<ul>${s.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ''
    return `<section><h2>${escapeHtml(s.title)}</h2>${s.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}${table}${bullets}</section>`
  }).join('\n')
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(r.title)} · 实验报告 3.0</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}body{margin:0;background:#f6f8fa;color:#1f2937;font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:920px;margin:32px auto;padding:36px 44px;background:#fff;border:1px solid #e5e9f0;border-radius:14px;box-shadow:0 6px 24px rgba(15,23,42,.06)}
h1{font-size:26px;margin:0 0 6px}h2{font-size:18px;margin:30px 0 10px;padding-bottom:6px;border-bottom:2px solid #3f8f79;color:#2c6654}
.meta{color:#64748b;font-size:13px;margin-bottom:22px}p{margin:8px 0}ul{padding-left:20px}li{margin:4px 0}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}th,td{border:1px solid #e2e8f0;padding:6px 9px;text-align:left}th{background:#f1f5f9;font-weight:600}
.chart{margin:16px 0;padding:12px;border:1px solid #e5e9f0;border-radius:10px;background:#fff}.chart svg{width:100%;height:auto;display:block}
footer{margin-top:28px;padding-top:14px;border-top:1px solid #e5e9f0;color:#94a3b8;font-size:12px}
@media print{body{background:#fff}main{box-shadow:none;border:none;margin:0;max-width:none}}
</style></head><body><main>
<h1>${escapeHtml(r.title)} · 实验报告 3.0</h1>
<div class="meta">实验 ID：${escapeHtml(r.experimentId)} ｜ 学科：${escapeHtml(r.subject)} ｜ 学习者：${escapeHtml(r.student)} ｜ 生成时间：${new Date(r.createdAt).toLocaleString('zh-CN')}</div>
<div class="chart">${chart}</div>
${body}
<footer>由智实验 V3 生成 · 数值内核自研 · 参考项目与许可证见「参考与致谢」章节${r.checksum ? ` · 快照 SHA-256 ${escapeHtml(r.checksum.slice(0, 16))}…` : ''}</footer>
</main></body></html>`
}

export function toCSV(rows: number[][], headers: string[] = []): string {
  const escape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines: string[] = []
  if (headers.length) lines.push(headers.map(escape).join(','))
  for (const r of rows) lines.push(r.map((v) => escape(String(v))).join(','))
  return `\ufeff${lines.join('\r\n')}` // BOM 便于 Excel 打开中文
}

export function toSnapshotJSON(snapshot: ExperimentSnapshot): string {
  return serializeSnapshot(snapshot)
}

export function exportReport(r: LabReport, format: 'markdown' | 'html'): string {
  return format === 'html' ? toHTML(r) : toMarkdown(r)
}

/** 浏览器下载（鸿蒙 WebView 下由原生桥接另行走文件写入） */
export function downloadFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): boolean {
  try {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    return true
  } catch {
    return false
  }
}
