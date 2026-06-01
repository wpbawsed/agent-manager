<template>
  <div style="padding:24px;">
    <div class="alert alert-info" style="margin-bottom:20px;">
      ⟳ <strong>replyTarget</strong> — 設定後，agent 會回覆到指定 URI，而非事件的原始來源。
      例如：Railway 部署事件 → 通知到 <code>slack://C1234567</code>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Routing Rules</div>
          <div class="card-sub">eventTypes 為空 = catch-all；符合則派送至指定 Queue</div>
        </div>
        <button class="btn btn-primary btn-sm" @click="openCreate">+ Add Rule</button>
      </div>
      <div v-if="routing.loading" class="empty">載入中...</div>
      <div v-else-if="!routing.rules.length" class="empty">尚無 Routing Rule</div>
      <table v-else>
        <thead>
          <tr>
            <th>Broker</th>
            <th>Queue</th>
            <th>Event Types</th>
            <th>Reply Target</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in routing.rules" :key="r.id">
            <td>
              <div style="font-weight:500;">{{ r.brokerName ?? r.brokerId }}</div>
              <span v-if="r.brokerType" class="chip" :class="r.brokerType" style="margin-top:4px;">{{ r.brokerType }}</span>
            </td>
            <td>
              <span v-if="r.queueName" class="queue-tag">{{ r.queueName }}</span>
              <span v-else style="color:var(--text3);">{{ r.queueId }}</span>
            </td>
            <td>
              <template v-if="routing.eventTypesList(r).length">
                <span v-for="et in routing.eventTypesList(r)" :key="et" class="event-tag">{{ et }}</span>
              </template>
              <span v-else class="catchall" style="color:var(--text3); font-style:italic; font-size:12px;">catch-all</span>
            </td>
            <td>
              <span v-if="r.replyTarget" class="mono" style="font-size:12px; color:var(--blue);">{{ r.replyTarget }}</span>
              <span v-else style="color:var(--text3); font-size:12px; font-style:italic;">原路回覆</span>
            </td>
            <td>
              <button class="btn btn-danger btn-sm" @click="deleteRule(r.id)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Add Rule Modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Add Routing Rule</div>
          <button class="modal-close" @click="showCreate = false">✕</button>
        </div>
        <div class="modal-body">
          <div v-if="createError" class="alert alert-error">{{ createError }}</div>
          <div class="form-group">
            <label class="form-label">Name (optional)</label>
            <input v-model="form.name" class="form-input" placeholder="Jira → jira-queue" />
          </div>
          <div class="form-group">
            <label class="form-label">Broker *</label>
            <select v-model="form.brokerId" class="form-select">
              <option value="">— Select broker —</option>
              <option v-for="b in brokers.brokers" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Queue *</label>
            <select v-model="form.queueId" class="form-select">
              <option value="">— Select queue —</option>
              <option v-for="q in queues.queues" :key="q.id" :value="q.id">{{ q.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Event Types (optional, 空白 = catch-all)</label>
            <input v-model="form.eventTypes" class="form-input" placeholder="issue_created, issue_updated" />
            <div class="form-hint">逗號分隔。符合 agentEvent.eventType 才派送</div>
          </div>
          <div class="form-group">
            <label class="form-label">Reply Target (optional)</label>
            <input v-model="form.replyTarget" class="form-input" placeholder="slack://C0987654321" />
            <div class="form-hint">留空則回覆到事件的原始來源。格式：slack:// jira:// notion:// webhook://</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="showCreate = false">Cancel</button>
          <button class="btn btn-primary" :disabled="creating" @click="createRule">
            {{ creating ? '建立中...' : 'Add Rule' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoutingStore } from '@/stores/routing'
import { useBrokersStore } from '@/stores/brokers'
import { useQueuesStore } from '@/stores/queues'

const routing = useRoutingStore()
const brokers = useBrokersStore()
const queues  = useQueuesStore()

const showCreate = ref(false)
const creating = ref(false)
const createError = ref('')
const form = ref({ name: '', brokerId: '', queueId: '', eventTypes: '', replyTarget: '' })

function openCreate() {
  form.value = { name: '', brokerId: '', queueId: '', eventTypes: '', replyTarget: '' }
  createError.value = ''
  showCreate.value = true
}

async function deleteRule(id: string) {
  if (!confirm('確定要刪除此 Routing Rule？')) return
  await routing.delete(id)
}

async function createRule() {
  if (!form.value.brokerId || !form.value.queueId) return
  creating.value = true
  createError.value = ''
  try {
    const eventTypes = form.value.eventTypes
      ? JSON.stringify(form.value.eventTypes.split(',').map((s) => s.trim()).filter(Boolean))
      : undefined
    await routing.create({
      name: form.value.name || undefined,
      brokerId: form.value.brokerId,
      queueId: form.value.queueId,
      eventTypes,
      replyTarget: form.value.replyTarget || undefined,
    })
    showCreate.value = false
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    createError.value = msg ?? '建立失敗'
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  routing.fetch()
  brokers.fetch()
  queues.fetch()
})
</script>
