<template>
  <div style="padding:24px;">
    <!-- Stats -->
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Total Agents</div>
        <div class="stat-value">{{ agents.agents.length }}</div>
        <div class="stat-sub">all agents</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Running</div>
        <div class="stat-value green">{{ runningCount }}</div>
        <div class="stat-sub">active processes</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Stopped</div>
        <div class="stat-value">{{ stoppedCount }}</div>
        <div class="stat-sub">idle agents</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Error</div>
        <div class="stat-value red">{{ errorCount }}</div>
        <div class="stat-sub">needs attention</div>
      </div>
    </div>

    <!-- Table -->
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">All Agents</div>
          <div class="card-sub">每個 Agent 綁定一個 Queue，收到任務後自動執行</div>
        </div>
        <button class="btn btn-primary btn-sm" @click="showCreate = true">+ New Agent</button>
      </div>
      <div v-if="agents.loading" class="empty">載入中...</div>
      <div v-else-if="!agents.agents.length" class="empty">尚無 Agent，點擊 + New Agent 建立</div>
      <table v-else>
        <thead>
          <tr>
            <th>Name</th>
            <th>Queue</th>
            <th>Status</th>
            <th>Instruction</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in agents.agents" :key="a.id">
            <td>
              <div style="font-weight:500;">{{ a.name }}</div>
              <div class="agent-id">{{ a.id }}</div>
            </td>
            <td>
              <span v-if="queueName(a.queueId)" class="queue-tag">{{ queueName(a.queueId) }}</span>
              <span v-else style="color:var(--text3); font-size:12px;">—</span>
            </td>
            <td><span class="badge" :class="a.status">{{ a.status }}</span></td>
            <td>
              <div class="instruction-preview">{{ a.instruction || '（未設定 instruction）' }}</div>
            </td>
            <td>
              <div class="action-group">
                <button
                  v-if="a.status !== 'running'"
                  class="btn btn-ghost btn-sm"
                  :disabled="starting === a.id"
                  @click="startAgent(a.id)"
                >▷ Start</button>
                <button
                  v-else
                  class="btn btn-ghost btn-sm"
                  :disabled="stopping === a.id"
                  @click="stopAgent(a.id)"
                >⏹ Stop</button>
                <button class="btn btn-danger btn-sm" @click="deleteAgent(a.id)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- New Agent Modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">New Agent</div>
          <button class="modal-close" @click="showCreate = false">✕</button>
        </div>
        <div class="modal-body">
          <div v-if="createError" class="alert alert-error">{{ createError }}</div>
          <div class="form-group">
            <label class="form-label">Name *</label>
            <input v-model="form.name" class="form-input" placeholder="jira-claude-cli-agent" />
          </div>
          <div class="form-group">
            <label class="form-label">Queue (optional)</label>
            <select v-model="form.queueId" class="form-select">
              <option value="">— Select queue —</option>
              <option v-for="q in queues.queues" :key="q.id" :value="q.id">{{ q.name }}</option>
            </select>
            <div class="form-hint">Agent 啟動後監聽此 Queue 的任務</div>
          </div>
          <div class="form-group">
            <label class="form-label">Instruction (optional)</label>
            <textarea v-model="form.instruction" class="form-textarea" placeholder="你是一個 Jira 自動化助理，收到 issue 後..." />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="showCreate = false">Cancel</button>
          <button class="btn btn-primary" :disabled="creating" @click="createAgent">
            {{ creating ? '建立中...' : 'Create Agent' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAgentsStore } from '@/stores/agents'
import { useQueuesStore } from '@/stores/queues'

const agents = useAgentsStore()
const queues = useQueuesStore()

const showCreate = ref(false)
const creating = ref(false)
const createError = ref('')
const starting = ref('')
const stopping = ref('')

const form = ref({ name: '', queueId: '', instruction: '' })

const runningCount = computed(() => agents.agents.filter((a) => a.status === 'running').length)
const stoppedCount = computed(() => agents.agents.filter((a) => a.status === 'stopped').length)
const errorCount   = computed(() => agents.agents.filter((a) => a.status === 'error').length)

function queueName(queueId?: string) {
  if (!queueId) return ''
  return queues.queues.find((q) => q.id === queueId)?.name ?? queueId.slice(0, 8)
}

async function startAgent(id: string) {
  starting.value = id
  try { await agents.start(id) } catch { /* ignore */ } finally { starting.value = '' }
}

async function stopAgent(id: string) {
  stopping.value = id
  try { await agents.stop(id) } catch { /* ignore */ } finally { stopping.value = '' }
}

async function deleteAgent(id: string) {
  if (!confirm('確定要刪除此 Agent？')) return
  await agents.delete(id)
}

async function createAgent() {
  if (!form.value.name) return
  creating.value = true
  createError.value = ''
  try {
    await agents.create({
      name: form.value.name,
      queueId: form.value.queueId || undefined,
      instruction: form.value.instruction || undefined,
    })
    form.value = { name: '', queueId: '', instruction: '' }
    showCreate.value = false
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    createError.value = msg ?? '建立失敗'
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  agents.fetch()
  queues.fetch()
})
</script>
