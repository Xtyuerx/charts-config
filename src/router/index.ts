import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/uploadPreview',
      name: 'uploadPreview',
      component: () => import('@/components/UploadPreview/index.vue'),
      meta: { title: '上传预览' },
    },
    {
      path: '/chartTable',
      name: 'chartTable',
      component: () => import('@/page/chartTable/index.vue'),
      meta: { title: '图表分析' },
    },
    {
      path: '/modelAnalysis',
      name: 'modelAnalysis',
      component: () => import('@/page/modelAnalysis/index.vue'),
      meta: { title: '模型分析' },
    },
  ],
})

export default router
