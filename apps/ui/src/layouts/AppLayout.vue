<template>
  <div style="display:flex; min-height:100vh;">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="logo-icon">A</div>
        <div>
          <div class="logo-text">Agent Manager</div>
          <div class="logo-sub">{{ auth.user?.subdomain ?? 'local' }}</div>
        </div>
      </div>

      <nav class="nav">
        <div class="nav-section">
          <div class="nav-label">Agents</div>
          <div class="nav-item" :class="{ active: route.path.startsWith('/agents') }" @click="go('/agents')">
            <span class="icon">⬡</span> Agents
          </div>
          <div class="nav-item" :class="{ active: route.path === '/queues' }" @click="go('/queues')">
            <span class="icon">▣</span> Queues
          </div>
        </div>
        <div class="nav-section">
          <div class="nav-label">Pipeline</div>
          <div class="nav-item" :class="{ active: route.path === '/brokers' }" @click="go('/brokers')">
            <span class="icon">⇄</span> Brokers
          </div>
          <div class="nav-item" :class="{ active: route.path === '/routing' }" @click="go('/routing')">
            <span class="icon">◈</span> Routing
          </div>
        </div>
        <div class="nav-section">
          <div class="nav-label">Observe</div>
          <div class="nav-item" :class="{ active: route.path === '/logs' }" @click="go('/logs')">
            <span class="icon">≡</span> Logs
          </div>
          <div class="nav-item" :class="{ active: route.path === '/playground' }" @click="go('/playground')">
            <span class="icon">▷</span> Playground
          </div>
        </div>
        <div v-if="auth.user?.role === 'admin'" class="nav-section">
          <div class="nav-label">System</div>
          <div class="nav-item" :class="{ active: route.path === '/admin' }" @click="go('/admin')">
            <span class="icon">⚙</span> Admin
          </div>
        </div>
      </nav>

      <div class="sidebar-footer">
        <div class="user-row" @click="logout">
          <div class="avatar">{{ initial }}</div>
          <div class="user-info">
            <div class="user-email">{{ auth.user?.email }}</div>
            <div class="user-role">{{ auth.user?.role }}</div>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main -->
    <div class="main">
      <header class="topbar">
        <span class="page-title">{{ pageTitle }}</span>
        <div style="display:flex; gap:8px; align-items:center;">
          <span style="font-size:12px; color:var(--text3);">{{ auth.user?.email }}</span>
          <button class="btn btn-ghost btn-sm" @click="logout">登出</button>
        </div>
      </header>
      <div class="content" style="padding:0; height:calc(100vh - 52px); overflow-y:auto;">
        <router-view />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const initial = computed(() => auth.user?.email?.[0]?.toUpperCase() ?? 'U')

const pageTitle = computed(() => {
  const map: Record<string, string> = {
    '/agents': 'Agents', '/queues': 'Queues', '/brokers': 'Brokers',
    '/routing': 'Routing', '/logs': 'Logs', '/playground': 'Playground', '/admin': 'Admin',
  }
  const key = '/' + route.path.split('/')[1]
  return map[key] ?? 'Agent Manager'
})

function go(path: string) { router.push(path) }

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0; left: 0; bottom: 0;
  z-index: 20;
}
.sidebar-logo {
  padding: 20px 16px 16px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 10px;
}
.logo-icon {
  width: 28px; height: 28px;
  background: var(--accent);
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; color: #0d0d0d;
}
.logo-text { font-size: 15px; font-weight: 600; letter-spacing: -.3px; }
.logo-sub  { font-size: 11px; color: var(--text2); }
.nav { padding: 12px 8px; flex: 1; overflow-y: auto; }
.nav-section { margin-bottom: 20px; }
.nav-label {
  font-size: 10px; font-weight: 600; letter-spacing: .08em;
  text-transform: uppercase; color: var(--text3); padding: 0 8px 6px;
}
.nav-item {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 8px; border-radius: var(--radius);
  cursor: pointer; color: var(--text2); font-size: 13.5px;
  transition: all .15s;
}
.nav-item:hover { background: var(--surface2); color: var(--text); }
.nav-item.active { background: var(--accent-bg); color: var(--accent); }
.nav-item .icon { font-size: 15px; width: 18px; text-align: center; }
.sidebar-footer {
  padding: 12px 8px 16px;
  border-top: 1px solid var(--border);
}
.user-row {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 8px; border-radius: var(--radius); cursor: pointer;
}
.user-row:hover { background: var(--surface2); }
.avatar {
  width: 26px; height: 26px; border-radius: 50%;
  background: linear-gradient(135deg, #6ee7b7, #60a5fa);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; color: #0d0d0d; flex-shrink: 0;
}
.user-info { flex: 1; overflow: hidden; }
.user-email { font-size: 12px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user-role  { font-size: 10px; color: var(--text3); }
.main {
  margin-left: var(--sidebar-w);
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.topbar {
  height: 52px;
  border-bottom: 1px solid var(--border);
  padding: 0 24px;
  display: flex; align-items: center; justify-content: space-between;
  background: var(--bg);
  position: sticky; top: 0; z-index: 10;
}
.page-title { font-size: 15px; font-weight: 600; }
</style>
