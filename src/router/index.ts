import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/modelAnalysis',
      name: 'modelAnalysis',
      component: () => import('@/page/modelAnalysis/index.vue'),
      meta: { title: '模型分析' },
    },
    {
      path: '/',
      name: 'demoModel',
      component: () => import('@/page/demoModel/demo.vue'),
      meta: { title: '模型分析' },
    },
    {
      path: '/chartTable',
      name: 'chartTable',
      component: () => import('@/page/chartTable/index.vue'),
      meta: { title: '图表分析' },
    },
    {
      path: '/mousic',
      name: 'mousic',
      component: () => import('@/page/mousic/index.vue'),
      meta: { title: '运动轨迹' },
    },
    {
      path: '/newModel',
      name: 'newModel',
      component: () => import('@/page/newModel/index.vue'),
      meta: { title: '数据模型' },
    },
    {
      path: '/old',
      name: 'old',
      component: () => import('@/page/old/index.vue'),
      meta: { title: '数据模型' },
    },
    {
      path: '/oralAnalysis',
      name: 'oralAnalysis',
      component: () => import('@/page/oralAnalysis/index.vue'),
      meta: { title: '口腔分析' },
    },
    {
      path: '/newAnalysis',
      name: 'newAnalysis',
      component: () => import('@/page/newAnalysis/modelAnalysis/index.vue'),
      meta: { title: '口腔分析' },
    },
    {
      path: '/paintAnalysis',
      name: 'paintAnalysis',
      component: () => import('@/components/three-demo/test/bvhVertexPaint.vue'),
      meta: { title: '涂色工具' },
    },
    {
      path: '/colorStl',
      name: 'colorStl',
      component: () => import('@/page/colorStl/index.vue'),
      meta: { title: '涂色STL' },
    },
    {
      path: '/jsonStl',
      name: 'jsonStl',
      component: () => import('@/page/jsonStl/index.vue'),
      meta: { title: 'STL标注JSON' },
    },
    {
      path: '/fStl',
      name: 'fStl',
      component: () => import('@/page/f/index.vue'),
      meta: { title: 'STL复原JSON' },
    },
  ],
})

export default router
