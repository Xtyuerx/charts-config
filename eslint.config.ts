import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default defineConfigWithVueTs(
  // 核心插件与基础配置先加载
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  skipFormatting,

  // 全局忽略
  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  // ✅ 最后覆盖 Vue 规则
  {
    name: 'app/custom-overrides',
    files: ['**/*.{ts,mts,tsx,vue}'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
)
