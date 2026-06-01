<template>
  <div style="padding:24px;">
    <!-- Tabs -->
    <div class="tabs" style="margin-bottom:20px;">
      <button class="tab" :class="{ active: tab === 'events' }" @click="tab = 'events'">Webhook Events</button>
      <button class="tab" :class="{ active: tab === 'agent' }" @click="tab = 'agent'">Agent Logs</button>
    </div>

    <!-- Webhook Events -->
    <div v-if="tab === 'events'">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Webhook Events</div>
          <div class="filter-row">
            <select v-model="filter.brokerId" class="form-select" style="width:160px;" @change="fetchEvents">
              <option value="">All Brokers</option>
              <option v-for="b in brokers.brokers" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
            <select v-model="filter.status" class="form-select" style="width:140px;" @change="fetchEvents">
              <option value="">All Status</option>
              <option value="received">received</option>
              <option value="routed">routed</option>
              <option value="failed">failed</option>
            </select>
          </div>
        </div>
        <div v-if="loadingEvents" class="empty">載入中...</div>
        <div v-else-if="!events.length" class="empty">無 Webhook 事件</div>
        <table v-else>
          <thead>
            <tr>
              <th>Time</th>
              <th>Broker</th>
              <th>Event Type</th>
              <th>Status</th>
              <th>Queue</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in events" :key="e.id">
              <td style="font-size:12px; color:var(--text3); white-space:nowrap;">{{ fmtTime(e.receivedAt) }}</td>
              <td style="font-size:13px;">{{ e.brokerName ?? e.brokerId }}</td>
              <td><code style="font-size:11px; color:var(--accent);">{{ e.eventType }}</code></td>
              <td><span class="badge" :class="e.status">{{ e.status }}</span></td>
              <td style="font-size:12px; color:var(--text2);">{{ e.queueName ?? '—' }}</td>
              <td>
                <button class="btn btn-ghost btn-sm" @click="showPayload(e)">View</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="events.length" class="card-footer">
          <button class="btn btn-ghost btn-sm" @click="loadMoreEvents">Load more</button>
        </div>
      </div>
    </div>

    <!-- Agent Logs -->
    <div v-if="tab === 'agent'">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Agent Execution Logs</div>
          <div class="filter-row">
            <select v-model="filter.agentId" class="form-select" style="width:160px;" @change="fetchAgentLogs">
              <option value="">All Agents</option>
              <option v-for="a in agents.agents" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
            <select v-model="filter.level" class="form-select" style="width:120px;" @change="fetchAgentLogs">
              <option value="">All Levels</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </div>
        </div>
        <div v-if="loadingAgent" class="empty">載入中...</div>
        <div v-else-if="!agentLogs.length" class="empty">無 Agent Log</div>
        <div v-else class="log-stream">
          <div v-for="l in agentLogs" :key="l.id" class="log-line" :class="l.level">
            <span class="log-ts">{{ fmtTime(l.createdAt) }}</span>
            <span class="log-level" :class="l.level">{{ l.level }}</span>
            <span class="log-agent">{{ l.agentName ?? l.agentId }}</span>
            <span class="log-msg">{{ l.message }}</span>
          </div>
        </div>
        <div v-if="agentLogs.length" class="card-footer">
          <button class="btn btn-ghost btn-sm" @click="loadMoreAgent">Load more</button>
        </div>
      </div>
    </div>

    <!-- Payload Modal -->
    <div v-if="selectedEvent" class="modal-overlay" @click.self="selectedEvent = null">
      <div class="modal" style="max-width:600px;">
        <div class="modal-header">
          <div class="modal-title">Event Payload</div>
          <button class="modal-close" @click="selectedEvent = null">✕</button>
        </div>
        <div class="modal-body">
          <pre style="overflow:auto; max-height:400px; font-size:12px; color:var(--text);">{{ JSON.stringify(selectedEvent.payload, null, 2) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAgentsStore } from '@/stores/agents'
import { useBrokersStore } from '@/stores/brokers'
import { logsApi } from '@/api'

const agents = useAgentsStore()
const brokers = useBrokersStore()

const tab = ref<'events' | 'agent'>('events')
const events = ref<any[]>([])
const agentLogs = ref<any[]>([])
const loadingEvents = ref(false)
const loadingAgent = ref(false)
const selectedEvent = ref<any>(null)

const filter = ref({ brokerId: '', status: '', agentId: '', level: '' })
let eventsPage = 0, agentPage = 0

function fmtTime(ts: number | string) {
  return new Date(ts).toLocaleTimeString('zh-TW', { hour12: false }) + ' ' +
    new Date(ts).toLocaleDateString('zh-TW')
}

function showPayload(e: any) { selectedEvent.value = e }

async function fetchEvents() {
  eventsPage = 0
  loadingEvents.value = true
  try {
    const res = await logsApi.webhookEvents({ brokerId: filter.value.brokerId || undefined, status: filter.value.status || undefined, limit: 30, offset: 0 })
    events.value = res.data.data ?? res.data
    eventsPage = 1
  } catch { events.value = [] }
  finally { loadingEvents.value = false }
}

async function loadMoreEvents() {
  const res = await logsApi.webhookEvents({ brokerId: filter.value.brokerId || undefined, status: filter.value.status || undefined, limit: 30, offset: eventsPage * 30 })
  events.value.push(...(res.data.data ?? res.data))
  eventsPage++
}

async function fetchAgentLogs() {
  agentPage = 0
  loadingAgent.value = true
  try {
    const res = await logsApi.agentLogs({ agentId: filter.value.agentId || undefined, level: filter.value.level || undefined, limit: 50, offset: 0 })
    agentLogs.value = res.data.data ?? res.data
    agentPage = 1
  } catch { agentLogs.value = [] }
  finally { loadingAgent.value = false }
}

async function loadMoreAgent() {
  const res = await logsApi.agentLogs({ agentId: filter.value.agentId || undefined, level: filter.value.level || undefined, limit: 50, offset: agentPage * 50 })
  agentLogs.value.push(...(res.data.data ?? res.data))
  agentPage++
}

onMounted(async () => {
  await Promise.all([agents.fetch(), brokers.fetch()])
  fetchEvents()
})
</script>

<style scoped>
.filter-row { display:flex; gap:8px; align-items:center; }
.log-stream { padding: 12px 16px; }
.log-line { display:flex; gap:12px; font-size:12px; padding:4px 0; border-bottom:1px solid var(--border); }
.log-ts { color:var(--text3); min-width:140px; }
.log-level { min-width:40px; font-weight:600; }
.log-level.info { color:var(--blue); }
.log-level.warn { color:var(--yellow); }
.log-level.error { color:var(--red); }
.log-agent { color:var(--accent); min-width:120px; }
.log-msg { color:var(--text); flex:1; }
.card-footer { padding:12px 16px; border-top:1px solid var(--border); text-align:center; }
</style>
