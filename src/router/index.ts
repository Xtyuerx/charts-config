import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'modelAnalysis',
      component: () => import('@/page/modelAnalysis/index.vue'),
      meta: { title: '模型分析' },
    },
    {
      path: '/chartTable',
      name: 'chartTable',
      component: () => import('@/page/chartTable/index.vue'),
      meta: { title: '图表分析' },
    },
  ],
})

export default router
