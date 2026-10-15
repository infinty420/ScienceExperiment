import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 鸿蒙端构建：单入口 hos.html，IIFE 非 module 格式 + 全内联单文件。
// 原因：鸿蒙 WebView 经 $rawfile 以 resource:// 溙加载，<script type="module">
// 在 opaque origin 下被 CORS 拦截（PC/Tauri 不受影响）。
const OUT = fileURLToPath(new URL('../entry/src/main/resources/rawfile/web', import.meta.url))
const INPUT = fileURLToPath(new URL('./hos.html', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    outDir: OUT,
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100 * 1024 * 1024,
    rollupOptions: {
      input: INPUT,
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/hos.js',
        chunkFileNames: 'assets/hos-[name].js',
        assetFileNames: 'assets/hos.[ext]'
      }
    }
  }
})
