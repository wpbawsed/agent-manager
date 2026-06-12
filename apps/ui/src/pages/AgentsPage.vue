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
        <div class="stat-label">Online</div>
        <div class="stat-value green">{{ onlineCount }}</div>
        <div class="stat-sub">heartbeat &lt; 90s</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Offline</div>
        <div class="stat-value">{{ offlineCount }}</div>
        <div class="stat-sub">no recent heartbeat</div>
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
          <div class="card-sub">Agent 自行回報心跳，Manager 只負責登記與觀察</div>
        </div>
        <button class="btn btn-primary btn-sm" @click="showCreate = true">+ New Agent</button>
      </div>
      <div v-if="agents.loading" class="empty">載入中...</div>
      <div v-else-if="!agents.agents.length" class="empty">尚無 Agent，點擊 + New Agent 建立</div>
      <table v-else>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
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
              <span class="type-tag" :class="a.type">{{ a.type === 'cloud' ? '☁ cloud' : '⌂ local' }}</span>
            </td>
            <td>
              <span v-if="queueName(a.queueId)" class="queue-tag">{{ queueName(a.queueId) }}</span>
              <span v-else style="color:var(--text3); font-size:12px;">—</span>
            </td>
            <td>
              <span class="badge" :class="a.online ? 'running' : (a.status === 'error' ? 'error' : 'stopped')">
                {{ a.online ? 'online' : (a.status === 'error' ? 'error' : 'offline') }}
              </span>
            </td>
            <td>
              <div class="instruction-preview">{{ a.instruction || '（未設定 instruction）' }}</div>
            </td>
            <td>
              <div class="action-group">
                <!-- cloud agents: manager controls lifecycle -->
                <template v-if="a.type === 'cloud'">
                  <button
                    v-if="a.status !== 'running'"
                    class="btn btn-ghost btn-sm"
                    :disabled="starting === a.id"
                    @click="startAgent(a.id)"
                  >▷ Deploy</button>
                  <button
                    v-else
                    class="btn btn-ghost btn-sm"
                    :disabled="stopping === a.id"
                    @click="stopAgent(a.id)"
                  >⏹ Stop</button>
                </template>
                <!-- local agents: self-managed; manager only hands out the setup material -->
                <button v-else class="btn btn-ghost btn-sm" @click="openIntegration(a.id)">⚙ Setup</button>
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
            <label class="form-label">Type *</label>
            <div class="type-picker">
              <label class="type-option" :class="{ active: form.type === 'local' }">
                <input v-model="form.type" type="radio" value="local" />
                <div>
                  <div class="type-option-title">⌂ Local</div>
                  <div class="type-option-desc">跑在你自己的機器（Claude Code CLI + claude channel）。建立後提供三個回報 API 與可直接使用的 Source Code。</div>
                </div>
              </label>
              <label class="type-option" :class="{ active: form.type === 'cloud' }">
                <input v-model="form.type" type="radio" value="cloud" />
                <div>
                  <div class="type-option-title">☁ Cloud</div>
                  <div class="type-option-desc">部署到 Cloudflare Sandbox。部署的程式碼已內建回報邏輯，由 Manager 控制啟停。</div>
                </div>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Name *</label>
            <input v-model="form.name" class="form-input" placeholder="jira-claude-cli-agent" />
          </div>

          <div v-if="form.type === 'local'" class="form-group">
            <label class="form-label">Endpoint (optional)</label>
            <input v-model="form.endpoint" class="form-input" placeholder="https://my-mac.tunnel.example.com:9090" />
            <div class="form-hint">本地 Agent 的對外 URL（僅供記錄，Manager 不會主動連線）</div>
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

    <!-- Integration / Onboarding Modal (local agents) -->
    <div v-if="integration" class="modal-overlay" @click.self="integration = null">
      <div class="modal modal-wide">
        <div class="modal-header">
          <div class="modal-title">接入你的 Local Agent</div>
          <button class="modal-close" @click="integration = null">✕</button>
        </div>
        <div class="modal-body">
          <div v-if="deployNote" class="alert alert-error">{{ deployNote }}</div>

          <div class="form-group">
            <label class="form-label">Agent ID / Token</label>
            <div class="kv-row"><span class="kv-key">AGENT_ID</span><code class="kv-val">{{ integration.agentId }}</code></div>
            <div class="kv-row"><span class="kv-key">AGENT_TOKEN</span><code class="kv-val">{{ integration.apiToken }}</code></div>
          </div>

          <div class="form-group">
            <label class="form-label">回報 API（你的 Agent 需要實作呼叫）</label>
            <div class="kv-row"><span class="kv-key">heartbeat</span><code class="kv-val">POST {{ integration.endpoints.heartbeat }}</code></div>
            <div class="kv-row"><span class="kv-key">metrics</span><code class="kv-val">POST {{ integration.endpoints.metrics }}</code></div>
            <div class="kv-row"><span class="kv-key">logs</span><code class="kv-val">POST {{ integration.endpoints.logs }}</code></div>
          </div>

          <div class="form-group">
            <label class="form-label">快速測試（curl）</label>
            <pre class="code-block">{{ integration.snippet }}</pre>
            <button class="btn btn-ghost btn-sm" @click="copy(integration.snippet)">Copy</button>
          </div>

          <div class="form-group">
            <label class="form-label">Source Code（可直接使用）</label>
            <div class="form-hint" style="margin-bottom:8px;">
              內含 BullMQ consumer + Claude CLI 呼叫 + 回報邏輯。下載後 npm install bullmq ioredis 即可執行。
            </div>
            <div class="file-tabs">
              <button
                v-for="(_, name) in integration.files"
                :key="name"
                class="file-tab"
                :class="{ active: activeFile === name }"
                @click="activeFile = String(name)"
              >{{ name }}</button>
            </div>
            <pre class="code-block code-block-scroll">{{ integration.files[activeFile] }}</pre>
            <div class="action-group" style="margin-top:8px;">
              <button class="btn btn-ghost btn-sm" @click="copy(integration.files[activeFile])">Copy {{ activeFile }}</button>
              <button class="btn btn-primary btn-sm" @click="downloadAll">Download all files</button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" @click="integration = null">Done</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAgentsStore, type AgentIntegration } from '@/stores/agents'
import { useQueuesStore } from '@/stores/queues'

const agents = useAgentsStore()
const queues = useQueuesStore()

const showCreate = ref(false)
const creating = ref(false)
const createError = ref('')
const starting = ref('')
const stopping = ref('')
const integration = ref<AgentIntegration | null>(null)
const activeFile = ref('index.js')
const deployNote = ref('')

const form = ref({ name: '', queueId: '', instruction: '', type: 'local' as 'local' | 'cloud', endpoint: '' })

const onlineCount  = computed(() => agents.agents.filter((a) => a.online).length)
const offlineCount = computed(() => agents.agents.filter((a) => !a.online && a.status !== 'error').length)
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

async function openIntegration(id: string) {
  deployNote.value = ''
  try {
    integration.value = await agents.integration(id)
    activeFile.value = 'index.js'
  } catch { /* ignore */ }
}

function copy(text: string) {
  navigator.clipboard.writeText(text)
}

function downloadAll() {
  if (!integration.value) return
  for (const [name, content] of Object.entries(integration.value.files)) {
    const blob = new Blob([content], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }
}

async function createAgent() {
  if (!form.value.name) return
  creating.value = true
  createError.value = ''
  try {
    const created = await agents.create({
      name: form.value.name,
      queueId: form.value.queueId || undefined,
      instruction: form.value.instruction || undefined,
      type: form.value.type,
      endpoint: form.value.endpoint || undefined,
    })
    form.value = { name: '', queueId: '', instruction: '', type: 'local', endpoint: '' }
    showCreate.value = false
    if (created.integration) {
      // local agent → show onboarding material immediately
      integration.value = created.integration
      activeFile.value = 'index.js'
      deployNote.value = ''
    } else if (created.deploy && !created.deploy.ok) {
      alert(`Agent 已建立，但 Cloudflare Sandbox 部署失敗：${created.deploy.error ?? 'unknown'}\n可稍後在列表按 Deploy 重試。`)
    }
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    createError.value = msg ?? '建立失敗'
  } finally {
    creating.value = false
  }
}

// Refresh periodically so online/offline reflects recent heartbeats.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  agents.fetch()
  queues.fetch()
  timer = setInterval(() => agents.fetch(), 30_000)
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
.type-picker { display: flex; gap: 10px; }
.type-option {
  flex: 1; display: flex; gap: 8px; padding: 10px 12px; cursor: pointer;
  border: 1px solid var(--border, #2a2d35); border-radius: 8px;
}
.type-option.active { border-color: var(--blue, #4a90d9); background: rgba(74, 144, 217, .08); }
.type-option input { margin-top: 3px; }
.type-option-title { font-weight: 500; font-size: 13px; }
.type-option-desc { font-size: 11px; color: var(--text2, #8b90a0); line-height: 1.5; margin-top: 2px; }

.type-tag { font-size: 11px; padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border, #2a2d35); }
.type-tag.cloud { color: #4a90d9; border-color: rgba(74, 144, 217, .4); }
.type-tag.local { color: #3db87a; border-color: rgba(61, 184, 122, .4); }

.modal-wide { width: 720px; max-width: 92vw; }
.kv-row { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; font-size: 12px; }
.kv-key { color: var(--text2, #8b90a0); width: 90px; flex-shrink: 0; }
.kv-val { word-break: break-all; }

.code-block {
  background: var(--surface2, #1e2026); border: 1px solid var(--border, #2a2d35);
  border-radius: 6px; padding: 10px 12px; font-size: 11px; line-height: 1.6;
  overflow-x: auto; white-space: pre; margin: 0 0 6px;
}
.code-block-scroll { max-height: 260px; overflow-y: auto; }

.file-tabs { display: flex; gap: 4px; margin-bottom: 6px; }
.file-tab {
  font-size: 11px; padding: 4px 10px; border-radius: 4px 4px 0 0; cursor: pointer;
  background: transparent; border: 1px solid var(--border, #2a2d35); color: var(--text2, #8b90a0);
}
.file-tab.active { color: var(--text, #e8eaf0); background: var(--surface2, #1e2026); }
</style>
