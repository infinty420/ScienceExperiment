# inline_hos.ps1 —— inline_hos.py 的 PowerShell 等价物（本机 python 不在 PATH 时使用）
# 用法: powershell -File pc/scripts/inline_hos.ps1 <rawfile/web 目录>
param([string]$Root = 'entry/src/main/resources/rawfile/web')
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$htmlPath = Join-Path $Root 'hos.html'
$html = [System.IO.File]::ReadAllText($htmlPath, [System.Text.Encoding]::UTF8)

# 内联 stylesheet
$html = [regex]::Replace($html, '<link rel="stylesheet"[^>]*href="\./(assets/[^"]+)"[^>]*/?>', {
  param($m)
  $css = [System.IO.File]::ReadAllText((Join-Path $Root $m.Groups[1].Value), [System.Text.Encoding]::UTF8)
  "<style>`n$css`n</style>"
})

# 内联 script
$html = [regex]::Replace($html, '<script[^>]*src="\./(assets/[^"]+)"[^>]*></script>', {
  param($m)
  $js = [System.IO.File]::ReadAllText((Join-Path $Root $m.Groups[1].Value), [System.Text.Encoding]::UTF8)
  if ($js.Contains('</script')) { throw 'FATAL: js contains </script, cannot inline safely' }
  "<script>`n$js`n</script>"
})

# 主脚本块迁移到 </body> 前（IIFE 无 defer 语义，head 中立即执行时 #app 尚未解析）
$m = [regex]::Match($html, '<script>\s*\nvar [A-Za-z_$_]')
if ($m.Success) {
  $start = $m.Index
  $end = $html.IndexOf('</script>', $start) + 9
  $block = $html.Substring($start, $end - $start)
  $html = $html.Remove($start, $end - $start)
  $pos = $html.LastIndexOf('</body>')
  if ($pos -ge 0) { $html = $html.Substring(0, $pos) + $block + "`n" + $html.Substring($pos) } else { $html += "`n" + $block }
  Write-Host 'app script relocated to end of <body>'
} else {
  Write-Host 'WARN: app script block not found for relocation'
}

if ([regex]::IsMatch($html, '(?:src|href)="\./assets/')) { throw 'FATAL: leftover external refs' }
[System.IO.File]::WriteAllText($htmlPath, $html, $utf8)
Remove-Item -Recurse -Force (Join-Path $Root 'assets') -ErrorAction SilentlyContinue
Write-Host ("inlined ok: hos.html {0} KB, assets removed" -f ((Get-Item $htmlPath).Length / 1KB))
