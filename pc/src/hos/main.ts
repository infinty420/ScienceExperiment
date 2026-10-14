import { createApp } from 'vue'
import HosApp from './HosApp.vue'

// 鸿蒙 WebView 宿主入口：全屏实验台，实验由原生通过 window.__hosBoot 注入
createApp(HosApp).mount('#app')
