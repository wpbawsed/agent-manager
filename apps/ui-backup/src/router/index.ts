import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "Login",
      component: () => import("@/pages/LoginPage.vue"),
      meta: { public: true },
    },
    {
      path: "/register",
      name: "Register",
      component: () => import("@/pages/RegisterPage.vue"),
      meta: { public: true },
    },
    {
      path: "/",
      redirect: "/agents",
      component: () => import("@/layouts/MainLayout.vue"),
      children: [
        {
          path: "agents",
          name: "Agents",
          component: () => import("@/pages/AgentsPage.vue"),
        },
        {
          path: "agents/:id/playground",
          name: "Playground",
          component: () => import("@/pages/PlaygroundPage.vue"),
        },
        {
          path: "agents/:id/detail",
          name: "AgentDetail",
          component: () => import("@/pages/AgentDetailPage.vue"),
        },
        {
          path: "queues",
          name: "Queues",
          component: () => import("@/pages/QueuesPage.vue"),
        },
        {
          path: "brokers",
          name: "Brokers",
          component: () => import("@/pages/BrokersPage.vue"),
        },
        {
          path: "routing",
          name: "Routing",
          component: () => import("@/pages/RoutingPage.vue"),
        },
        {
          path: "logs",
          name: "Logs",
          component: () => import("@/pages/LogsPage.vue"),
        },
        {
          path: "admin",
          name: "Admin",
          component: () => import("@/pages/AdminPage.vue"),
          meta: { adminOnly: true },
        },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isLoggedIn()) {
    return { name: "Login" };
  }
  if (to.meta.adminOnly && auth.user?.role !== "admin") {
    return { name: "Agents" };
  }
});

export default router;
