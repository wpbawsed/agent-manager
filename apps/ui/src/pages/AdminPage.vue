<template>
  <div style="padding:24px;">
    <div class="card">
      <div class="card-header">
        <div class="card-title">System Stats</div>
      </div>
      <div class="stats-row" style="display:flex; gap:16px; padding:16px; flex-wrap:wrap;">
        <div class="stat-card">
          <div class="stat-value">{{ stats.totalAgents }}</div>
          <div class="stat-label">Total Agents</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--green);">{{ stats.activeAgents }}</div>
          <div class="stat-label">Active Agents</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.totalBrokers }}</div>
          <div class="stat-label">Brokers</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.totalQueues }}</div>
          <div class="stat-label">Queues</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.totalUsers }}</div>
          <div class="stat-label">Users</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:20px;">
      <div class="card-header">
        <div class="card-title">User Management</div>
      </div>
      <div v-if="loading" class="empty">載入中...</div>
      <div v-else-if="!users.length" class="empty">無使用者</div>
      <table v-else>
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>
              <div style="display:flex; align-items:center; gap:8px;">
                <div class="avatar">{{ u.username[0]?.toUpperCase() }}</div>
                {{ u.username }}
              </div>
            </td>
            <td><span class="badge" :class="u.role">{{ u.role }}</span></td>
            <td style="font-size:12px; color:var(--text3);">{{ fmtDate(u.createdAt) }}</td>
            <td>
              <div class="action-group">
                <button v-if="u.role !== 'admin'" class="btn btn-ghost btn-sm" @click="setAdmin(u.id)">→ admin</button>
                <button class="btn btn-danger btn-sm" @click="deleteUser(u.id)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { adminApi } from '@/api'
import { useAgentsStore } from '@/stores/agents'
import { useBrokersStore } from '@/stores/brokers'
import { useQueuesStore } from '@/stores/queues'

const agentsStore = useAgentsStore()
const brokersStore = useBrokersStore()
const queuesStore = useQueuesStore()

const users = ref<any[]>([])
const loading = ref(false)

const stats = computed(() => ({
  totalAgents: agentsStore.agents.length,
  activeAgents: agentsStore.agents.filter((a) => a.status === 'running').length,
  totalBrokers: brokersStore.brokers.length,
  totalQueues: queuesStore.queues.length,
  totalUsers: users.value.length,
}))

function fmtDate(ts: number | string) {
  return new Date(ts).toLocaleDateString('zh-TW')
}

async function fetchUsers() {
  loading.value = true
  try {
    const res = await adminApi.users()
    users.value = res.data.users ?? res.data
  } finally {
    loading.value = false
  }
}

async function setAdmin(id: string) {
  await adminApi.setRole(id, 'admin')
  fetchUsers()
}

async function deleteUser(id: string) {
  if (!confirm('確定要刪除此使用者？')) return
  await adminApi.deleteUser(id)
  fetchUsers()
}

onMounted(async () => {
  await Promise.all([
    agentsStore.fetch(),
    brokersStore.fetch(),
    queuesStore.fetch(),
    fetchUsers(),
  ])
})
</script>

<style scoped>
.stat-card {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  min-width: 120px;
  text-align: center;
}
.stat-value { font-size: 28px; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 12px; color: var(--text3); margin-top: 4px; }
.avatar {
  width: 28px; height: 28px;
  background: var(--accent);
  color: #0d0d0d;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 13px;
}
</style>
