<template>
  <div style="padding:24px;">
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Webhook Sources</div>
          <div class="card-sub">Each broker receives events from one external platform</div>
        </div>
        <button class="btn btn-primary btn-sm" @click="openCreate">+ New Broker</button>
      </div>
      <div v-if="brokers.loading" class="empty">載入中...</div>
      <div v-else-if="!brokers.brokers.length" class="empty">尚無 Broker</div>
      <table v-else>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th>Webhook URL</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in brokers.brokers" :key="b.id">
            <td style="font-weight:500;">{{ b.name }}</td>
            <td><span class="chip" :class="b.type">{{ b.type }}</span></td>
            <td><span class="badge" :class="b.status">{{ b.status }}</span></td>
            <td>
              <div class="url-box" style="max-width:340px;">
                <span>{{ webhookUrl(b) }}</span>
                <button class="btn btn-ghost btn-sm" @click="copyUrl(b)">Copy</button>
              </div>
            </td>
            <td>
              <div class="action-group">
                <button v-if="b.status === 'inactive'" class="btn btn-ghost btn-sm" @click="brokers.activate(b.id)">Activate</button>
                <button v-else class="btn btn-ghost btn-sm" @click="brokers.deactivate(b.id)">Deactivate</button>
                <button class="btn btn-danger btn-sm" @click="deleteBroker(b.id)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- New Broker Modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">New Broker</div>
          <button class="modal-close" @click="showCreate = false">✕</button>
        </div>
        <div class="modal-body">
          <div v-if="createError" class="alert alert-error">{{ createError }}</div>
          <div class="form-group">
            <label class="form-label">Name *</label>
            <input v-model="form.name" class="form-input" placeholder="Wishmobile Jira" />
          </div>
          <div class="form-group">
            <label class="form-label">Type *</label>
            <select v-model="form.type" class="form-select">
              <option value="">— Select type —</option>
              <option v-for="t in brokerTypes" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Signing Secret</label>
            <input v-model="form.signingSecret" class="form-input" type="password" placeholder="webhook signing secret" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="showCreate = false">Cancel</button>
          <button class="btn btn-primary" :disabled="creating" @click="createBroker">
            {{ creating ? '建立中...' : 'Create Broker' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Copy success toast -->
    <div v-if="copied" class="toast">✓ URL 已複製</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useBrokersStore } from '@/stores/brokers'
import type { Broker } from '@/stores/brokers'

const brokers = useBrokersStore()

const showCreate = ref(false)
const creating = ref(false)
const createError = ref('')
const copied = ref(false)

const brokerTypes = ['jira', 'notion', 'slack', 'line', 'railway', 'github']
const form = ref({ name: '', type: '', signingSecret: '' })

function webhookUrl(b: Broker) {
  const host = window.location.origin.replace(':3000', ':8080')
  return `${host}${b.webhookPath}`
}

async function copyUrl(b: Broker) {
  await navigator.clipboard.writeText(webhookUrl(b))
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

function openCreate() {
  form.value = { name: '', type: '', signingSecret: '' }
  createError.value = ''
  showCreate.value = true
}

async function deleteBroker(id: string) {
  if (!confirm('確定要刪除此 Broker？')) return
  await brokers.delete(id)
}

async function createBroker() {
  if (!form.value.name || !form.value.type) return
  creating.value = true
  createError.value = ''
  try {
    await brokers.create({
      name: form.value.name,
      type: form.value.type,
      config: { signing_secret: form.value.signingSecret },
    })
    showCreate.value = false
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    createError.value = msg ?? '建立失敗'
  } finally {
    creating.value = false
  }
}

onMounted(() => brokers.fetch())
</script>

<style scoped>
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: var(--accent);
  color: #0d0d0d;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  z-index: 200;
}
</style>
