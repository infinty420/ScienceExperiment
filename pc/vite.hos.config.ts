import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 鸿蒙端构建：单入口 hos.html，相对路径 base，产物直接输出到 entry rawfile/web/
const OUT = fileURLToPath(new URL('../entry/src/main/resources/rawfile/web', import.meta.url))
const INPUT = fileURLToPath(new URL('./hos.html', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    outDir: OUT,
    emptyOutDir: true,
    rollupOptions: {
      input: INPUT,
      output: {
        manualChunks: {
          three: ['three'],
          'cannon-es': ['cannon-es']
        }
      }
    }
  }
})
