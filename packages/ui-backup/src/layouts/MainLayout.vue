<template>
  <n-layout has-sider style="height: 100vh;">
    <n-layout-sider
      bordered
      collapse-mode="width"
      :collapsed-width="64"
      :width="200"
      :collapsed="collapsed"
      show-trigger
      @collapse="collapsed = true"
      @expand="collapsed = false"
    >
      <div style="padding: 16px 12px; font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden;">
        {{ collapsed ? 'AM' : 'Agent Manager' }}
      </div>
      <n-menu
        :collapsed="collapsed"
        :collapsed-width="64"
        :options="menuOptions"
        :value="activeKey"
        @update:value="onMenuSelect"
      />
    </n-layout-sider>

    <n-layout>
      <n-layout-header bordered style="height: 48px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 14px; color: #999;">{{ pageTitle }}</span>
        <n-dropdown :options="userMenuOptions" @select="onUserMenuSelect">
          <n-button text>
            {{ authStore.user?.email ?? '帳號' }}
          </n-button>
        </n-dropdown>
      </n-layout-header>
      <n-layout-content style="padding: 24px; overflow: auto; height: calc(100vh - 48px);">
        <router-view />
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<script setup lang="ts">
import { ref, computed, h } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  NLayout, NLayoutSider, NLayoutHeader, NLayoutContent,
  NMenu, NButton, NDropdown,
  type MenuOption
} from 'naive-ui'
import { useAuthStore } from '@/stores/auth'

const collapsed = ref(false)
const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const menuOptions = computed<MenuOption[]>(() => {
  const base: MenuOption[] = [
    { label: 'Agents', key: '/agents', icon: () => h('span', { class: 'menu-icon' }, '🤖') },
    { label: 'Queues', key: '/queues', icon: () => h('span', { class: 'menu-icon' }, '📬') },
    { label: 'Brokers', key: '/brokers', icon: () => h('span', { class: 'menu-icon' }, '🔌') },
    { label: 'Routing', key: '/routing', icon: () => h('span', { class: 'menu-icon' }, '🔀') },
    { label: 'Logs', key: '/logs', icon: () => h('span', { class: 'menu-icon' }, '📋') },
  ]
  if (authStore.user?.role === 'admin') {
    base.push({ label: 'Admin', key: '/admin', icon: () => h('span', { class: 'menu-icon' }, '⚙️') })
  }
  return base
})

const activeKey = computed(() => '/' + route.path.split('/')[1])

const pageTitle = computed(() => {
  const map: Record<string, string> = {
    '/agents': 'Agents',
    '/queues': 'Queues',
    '/brokers': 'Brokers',
    '/routing': 'Routing',
    '/logs': 'Logs',
    '/playground': 'Playground',
    '/admin': 'Admin',
  }
  return map[activeKey.value] ?? ''
})

const userMenuOptions = [
  { label: '登出', key: 'logout' },
]

function onMenuSelect(key: string) {
  router.push(key)
}

function onUserMenuSelect(key: string) {
  if (key === 'logout') {
    authStore.clearAuth()
    router.push('/login')
  }
}
</script>
