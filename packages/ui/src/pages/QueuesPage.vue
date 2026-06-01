<template>
  <div style="padding:24px;">
    <div class="alert alert-info" style="margin-bottom:20px;">
      ▣ Queue 是獨立實體（如 SQS），由 Routing Rule 決定哪個 Broker 事件打進來，Agent 1:1 綁定 Queue 監聽。
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">All Queues</div>
          <div class="card-sub">每個 Queue 可被多個 Routing Rule 指向，但只能被一個 Agent 消費</div>
        </div>
        <button class="btn btn-primary btn-sm" @click="showCreate = true">+ New Queue</button>
      </div>
      <div v-if="queues.loading" class="empty">載入中...</div>
      <div v-else-if="!queues.queues.length" class="empty">尚無 Queue</div>
      <table v-else>
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Agent</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="q in queues.queues" :key="q.id">
            <td><code style="color:var(--accent); font-size:13px;">{{ q.name }}</code></td>
            <td style="color:var(--text2);">{{ q.description || '—' }}</td>
            <td>
              <span v-if="agentForQueue(q.id)" style="font-size:12px; color:var(--text);">{{ agentForQueue(q.id) }}</span>
              <span v-else style="font-size:12px; color:var(--text3);">No agent</span>
            </td>
            <td style="color:var(--text3); font-size:12px;">{{ fmtDate(q.createdAt) }}</td>
            <td>
              <button class="btn btn-danger btn-sm" @click="deleteQueue(q.id)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- New Queue Modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">New Queue</div>
          <button class="modal-close" @click="showCreate = false">✕</button>
        </div>
        <div class="modal-body">
          <div v-if="createError" class="alert alert-error">{{ createError }}</div>
          <div class="form-group">
            <label class="form-label">Queue Name *</label>
            <input v-model="form.name" class="form-input" placeholder="jira-queue" />
            <div class="form-hint">唯一識別名稱，對應 BullMQ queue name</div>
          </div>
          <div class="form-group">
            <label class="form-label">Description (optional)</label>
            <input v-model="form.description" class="form-input" placeholder="Jira issue events" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="showCreate = false">Cancel</button>
          <button class="btn btn-primary" :disabled="creating" @click="createQueue">
            {{ creating ? '建立中...' : 'Create Queue' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useQueuesStore } from '@/stores/queues'
import { useAgentsStore } from '@/stores/agents'

const queues = useQueuesStore()
const agents = useAgentsStore()

const showCreate = ref(false)
const creating = ref(false)
const createError = ref('')
const form = ref({ name: '', description: '' })

function agentForQueue(queueId: string) {
  return agents.agents.find((a) => a.queueId === queueId)?.name ?? ''
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('zh-TW')
}

async function deleteQueue(id: string) {
  if (!confirm('確定要刪除此 Queue？')) return
  await queues.delete(id)
}

async function createQueue() {
  if (!form.value.name) return
  creating.value = true
  createError.value = ''
  try {
    await queues.create({ name: form.value.name, description: form.value.description || undefined })
    form.value = { name: '', description: '' }
    showCreate.value = false
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    createError.value = msg ?? '建立失敗'
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  queues.fetch()
  agents.fetch()
})
</script>
