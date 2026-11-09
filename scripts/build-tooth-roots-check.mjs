// 生产打包验证：沿用项目插件，关闭生成 d.ts 的文件写入，避免受宿主锁文件影响。
import { fileURLToPath, URL } from 'node:url'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
await build({
  configFile: false,
  plugins: [
    vue(), vueDevTools(),
    AutoImport({ resolvers: [ElementPlusResolver()], dts: false }),
    Components({ resolvers: [ElementPlusResolver()], dts: false }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
})
