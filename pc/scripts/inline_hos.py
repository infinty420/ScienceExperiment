"""把 Vite 产物 hos.html 内联为单文件（script/css 全内联），供鸿蒙 rawfile 离线加载。

用法: python inline_hos.py <rawfile/web 目录>
构建后运行：hos.html 中引用 ./assets/hos.js 与 ./assets/hos.css 被替换为内联内容，
随后删除 assets 目录。若 JS 内容包含 "</script"（会截断内联）则报错退出。
"""
import os
import re
import shutil
import sys

root = sys.argv[1] if len(sys.argv) > 1 else '.'
html_path = os.path.join(root, 'hos.html')
assets = os.path.join(root, 'assets')

html = open(html_path, encoding='utf-8').read()

# 内联 stylesheet
def css_repl(m):
    css = open(os.path.join(root, m.group(1)), encoding='utf-8').read()
    return '<style>\n' + css + '\n</style>'

html2 = re.sub(r'<link rel="stylesheet"[^>]*href="\./(assets/[^"]+)"[^>]*/?>', css_repl, html)

# 内联 script
def js_repl(m):
    js = open(os.path.join(root, m.group(1)), encoding='utf-8').read()
    if '</script' in js:
        print('FATAL: js contains </script, cannot inline safely')
        sys.exit(1)
    return '<script>\n' + js + '\n</script>'

html2 = re.sub(r'<script[^>]*src="\./(assets/[^"]+)"[^>]*></script>', js_repl, html2)

# 关键修复：把主应用脚本挪到 </body> 前。
# Vite 会把入口脚本注入 <head>；IIFE 经典脚本没有 module 的 defer 语义，
# 在 head 中立即执行时 <div id="app"> 尚未解析 → mount('#app') 返回 null 静默失败。
m = re.search(r'<script>\s*\nvar [A-Za-z_$_]', html2)
if m:
    start = m.start()
    end = html2.index('</script>', start) + len('</script>')
    block = html2[start:end]
    html2 = html2[:start] + html2[end:]
    if '</body>' in html2:
        html2 = html2.replace('</body>', block + '\n</body>')
    else:
        html2 += '\n' + block
    print('app script relocated to end of <body>')
else:
    print('WARN: app script block not found for relocation')

# 残留外链检查
leftover = re.findall(r'(?:src|href)="\./assets/[^"]*"', html2)
if leftover:
    print('FATAL: leftover external refs:', leftover)
    sys.exit(1)

open(html_path, 'w', encoding='utf-8').write(html2)
shutil.rmtree(assets, ignore_errors=True)
print(f'inlined ok: hos.html {os.path.getsize(html_path)//1024} KB, assets removed')
