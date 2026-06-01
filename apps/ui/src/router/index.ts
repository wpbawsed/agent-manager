import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login',    name: 'login',    component: () => import('@/pages/LoginPage.vue'),    meta: { public: true } },
    { path: '/register', name: 'register', component: () => import('@/pages/RegisterPage.vue'), meta: { public: true } },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      children: [
        { path: '',          redirect: '/agents' },
        { path: 'agents',    name: 'agents',    component: () => import('@/pages/AgentsPage.vue') },
        { path: 'queues',    name: 'queues',    component: () => import('@/pages/QueuesPage.vue') },
        { path: 'brokers',   name: 'brokers',   component: () => import('@/pages/BrokersPage.vue') },
        { path: 'routing',   name: 'routing',   component: () => import('@/pages/RoutingPage.vue') },
        { path: 'logs',      name: 'logs',      component: () => import('@/pages/LogsPage.vue') },
        { path: 'playground',name: 'playground',component: () => import('@/pages/PlaygroundPage.vue') },
        { path: 'admin',     name: 'admin',     component: () => import('@/pages/AdminPage.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/agents' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.isLoggedIn) return '/login'
  if (to.meta.public && auth.isLoggedIn) return '/agents'
  if (auth.isLoggedIn && !auth.user) await auth.fetchMe()
})

export default router
