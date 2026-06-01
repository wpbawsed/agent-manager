<template>
  <div>
    <n-tabs v-model:value="activeTab" type="line" animated>
      <!-- Agent Execution Logs Tab -->
      <n-tab-pane name="agent" tab="Agent 執行日誌">
        <div style="display: flex; gap: 12px; margin-bottom: 12px; align-items: center;">
          <n-select
            v-model:value="selectedAgentId"
            :options="agentOptions"
            placeholder="選擇 Agent"
            clearable
            style="width: 220px;"
          />
          <n-select
            v-model:value="selectedLevel"
            :options="levelOptions"
            placeholder="日誌等級"
            clearable
            style="width: 140px;"
          />
          <n-button @click="loadLogs" :loading="logsLoading">查詢</n-button>
          <div style="margin-left: auto; display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 12px; color: #999;">即時串流</span>
            <n-switch v-model:value="streamEnabled" @update:value="toggleStream" />
          </div>
        </div>

        <!-- SSE Stream Banner -->
        <div v-if="streamEnabled && streamAgentId" style="margin-bottom: 8px;">
          <n-alert type="info" :title="`串流中：${agentName(streamAgentId)}`" closable @close="stopStream">
            {{ streamLines.length }} 行即時日誌
          </n-alert>
          <div
            ref="streamContainerRef"
            style="font-family: monospace; font-size: 12px; height: 200px; overflow-y: auto; background: #1a1a2e; padding: 10px; border-radius: 4px; margin-top: 8px;"
          >
            <div v-for="(line, i) in streamLines" :key="i" :style="{ color: line.level === 'error' ? '#ff6b6b' : '#a8ff78' }">
              <span style="color: #555; margin-right: 6px;">{{ formatTime(line.ts) }}</span>{{ line.msg }}
            </div>
          </div>
        </div>

        <!-- History Table -->
        <n-data-table
          :columns="agentLogColumns"
          :data="filteredLogs"
          :loading="logsLoading"
          size="small"
          max-height="400"
        />
      </n-tab-pane>

      <!-- Event Logs Tab (D1 — future) -->
      <n-tab-pane name="events" tab="事件日誌（Workers）">
        <n-empty description="事件日誌由 Cloudflare Workers 寫入 D1，尚未支援查詢介面" />
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted, h } from 'vue'
import {
  NTabs, NTabPane, NDataTable, NSelect, NButton, NSwitch,
  NAlert, NEmpty,
  type DataTableColumns
} from 'naive-ui'
import { useAgentsStore } from '@/stores/agents'
import { listAgentLogs, type AgentLog } from '@/api/logs'
import { API_BASE_URL } from '@/api/config'

const agentsStore = useAgentsStore()
agentsStore.fetchAgents()

const activeTab = ref('agent')
const selectedAgentId = ref<string | null>(null)
const selectedLevel = ref<string | null>(null)
const logsLoading = ref(false)
const allLogs = ref<AgentLog[]>([])

const agentOptions = computed(() =>
  agentsStore.agents.map(a => ({ label: a.name, value: a.id }))
)
const levelOptions = [
  { label: 'info', value: 'info' },
  { label: 'error', value: 'error' },
]

function agentName(id: string) {
  return agentsStore.agents.find(a => a.id === id)?.name ?? id.slice(0, 8)
}

async function loadLogs() {
  logsLoading.value = true
  try {
    allLogs.value = await listAgentLogs({
      agentId: selectedAgentId.value ?? undefined,
      limit: 500,
    })
  } finally {
    logsLoading.value = false
  }
}

const filteredLogs = computed(() => {
  if (!selectedLevel.value) return allLogs.value
  return allLogs.value.filter(l => l.level === selectedLevel.value)
})

// Load on mount
loadLogs()

// --- SSE Stream ---
const streamEnabled = ref(false)
const streamAgentId = ref<string | null>(null)
const streamLines = ref<{ level: string; msg: string; ts: number }[]>([])
const streamContainerRef = ref<HTMLElement | null>(null)
let eventSource: EventSource | null = null

function toggleStream(val: boolean) {
  if (val) {
    if (!selectedAgentId.value) {
      streamEnabled.value = false
      return
    }
    startStream(selectedAgentId.value)
  } else {
    stopStream()
  }
}

function startStream(agentId: string) {
  stopStream()
  streamAgentId.value = agentId
  streamLines.value = []
  const token = localStorage.getItem('token')
  eventSource = new EventSource(`${API_BASE_URL}/agents/${agentId}/logs/stream?token=${encodeURIComponent(token ?? '')}`)
  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      streamLines.value.push({ level: data.level ?? 'info', msg: data.message ?? e.data, ts: data.timestamp ?? Date.now() })
      nextTick(() => {
        if (streamContainerRef.value) {
          streamContainerRef.value.scrollTop = streamContainerRef.value.scrollHeight
        }
      })
    } catch {
      streamLines.value.push({ level: 'info', msg: e.data, ts: Date.now() })
    }
  }
}

function stopStream() {
  eventSource?.close()
  eventSource = null
  streamAgentId.value = null
  streamEnabled.value = false
}

onUnmounted(() => {
  eventSource?.close()
})

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString()
}

const agentLogColumns: DataTableColumns<AgentLog> = [
  {
    title: '時間',
    key: 'createdAt',
    width: 130,
    render: (row) => formatTime(row.createdAt),
  },
  {
    title: 'Agent',
    key: 'agentId',
    width: 140,
    render: (row) => agentName(row.agentId),
  },
  {
    title: '等級',
    key: 'level',
    width: 70,
    render: (row) => h('span', {
      style: { color: row.level === 'error' ? '#ff6b6b' : '#86efac', fontSize: '12px' }
    }, row.level),
  },
  {
    title: '訊息',
    key: 'message',
    ellipsis: { tooltip: true },
  },
]
</script>
