<template>
  <div style="display: flex; gap: 16px; height: calc(100vh - 96px);">
    <!-- Vue Flow Graph -->
    <div style="flex: 1; border: 1px solid #333; border-radius: 8px; overflow: hidden; background: #0f0f1a;">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :fit-view-on-init="true"
        :default-zoom="1"
      >
        <Background />
        <Controls />
        <MiniMap />

        <template #node-broker="{ data }">
          <div class="flow-node broker-node">
            <div class="node-label">🔌 {{ data.label }}</div>
            <div class="node-type">{{ data.type }}</div>
            <div :class="['node-status', data.status]">{{ data.status }}</div>
          </div>
        </template>

        <template #node-queue="{ data }">
          <div class="flow-node queue-node">
            <div class="node-label">📬 {{ data.label }}</div>
            <div class="node-type">queue</div>
          </div>
        </template>

        <template #node-agent="{ data }">
          <div class="flow-node agent-node">
            <div class="node-label">🤖 {{ data.label }}</div>
            <div :class="['node-status', data.status]">{{ data.status }}</div>
          </div>
        </template>
      </VueFlow>
    </div>

    <!-- Right Panel -->
    <div style="width: 300px; display: flex; flex-direction: column; gap: 12px;">
      <!-- Add Rule -->
      <n-card title="新增路由規則" size="small">
        <n-form label-placement="top" size="small">
          <n-form-item label="名稱（選填）">
            <n-input v-model:value="newRule.name" placeholder="my-rule" />
          </n-form-item>
          <n-form-item label="Broker">
            <n-select
              v-model:value="newRule.brokerId"
              :options="brokerOptions"
              placeholder="選擇 Broker"
            />
          </n-form-item>
          <n-form-item label="Queue">
            <n-select
              v-model:value="newRule.queueId"
              :options="queueOptions"
              placeholder="選擇 Queue"
            />
          </n-form-item>
          <n-form-item label="Event Types（選填，空白 = 全部接收）">
            <n-select
              v-model:value="newRule.eventTypes"
              multiple
              filterable
              tag
              :options="eventTypeOptions"
              placeholder="輸入後 Enter 新增"
            />
          </n-form-item>
          <n-button
            type="primary"
            size="small"
            block
            :loading="adding"
            :disabled="!newRule.brokerId || !newRule.queueId"
            @click="addRule"
          >
            建立連線
          </n-button>
        </n-form>
      </n-card>

      <!-- Rule List -->
      <n-card title="現有規則" size="small" style="flex: 1; overflow: auto;">
        <n-empty v-if="routingStore.rules.length === 0" description="尚無規則" size="small" />
        <div v-for="rule in routingStore.rules" :key="rule.id" style="margin-bottom: 8px; padding: 8px; background: #1a1a2e; border-radius: 4px;">
          <div style="font-size: 12px; font-weight: 600; margin-bottom: 2px;">
            {{ rule.name || '(未命名)' }}
          </div>
          <div style="font-size: 11px; color: #999; margin-bottom: 4px;">
            {{ brokerName(rule.brokerId) }} → {{ queueName(rule.queueId) }}
          </div>
          <div v-if="rule.eventTypes" style="font-size: 11px; color: #7c3aed; margin-bottom: 4px;">
            {{ parsedEventTypes(rule.eventTypes).join(', ') }}
          </div>
          <n-popconfirm @positive-click="removeRule(rule.id)">
            <template #trigger>
              <n-button size="tiny" type="error">刪除</n-button>
            </template>
            確認刪除此路由規則？
          </n-popconfirm>
        </div>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { VueFlow, type Node, type Edge } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import {
  NCard, NForm, NFormItem, NSelect, NInput, NButton, NEmpty, NPopconfirm
} from 'naive-ui'
import { useAgentsStore } from '@/stores/agents'
import { useBrokersStore } from '@/stores/brokers'
import { useQueuesStore } from '@/stores/queues'
import { useRoutingStore } from '@/stores/routing'

const agentsStore = useAgentsStore()
const brokersStore = useBrokersStore()
const queuesStore = useQueuesStore()
const routingStore = useRoutingStore()

agentsStore.fetchAgents()
brokersStore.fetchBrokers()
queuesStore.fetchQueues()
routingStore.fetchRules()

// Select options
const brokerOptions = computed(() =>
  brokersStore.brokers.map(b => ({ label: `${b.name} (${b.type})`, value: b.id }))
)
const queueOptions = computed(() =>
  queuesStore.queues.map(q => ({ label: q.name, value: q.id }))
)

// Common event types per broker type (used as hints; user can type custom ones too)
const eventTypeOptions = computed(() => {
  const broker = brokersStore.brokers.find(b => b.id === newRule.brokerId)
  const hints: Record<string, string[]> = {
    jira: ['issue_created', 'issue_updated', 'issue_commented', 'issue_deleted'],
    railway: ['deployment_failed', 'deployment_success', 'deployment_started'],
    slack: ['message', 'app_mention'],
    github: ['push', 'pull_request', 'issues'],
    line: ['message', 'follow'],
    notion: ['page_created', 'page_updated'],
  }
  const types = broker ? (hints[broker.type] ?? []) : []
  return types.map(t => ({ label: t, value: t }))
})

function brokerName(id: string) {
  return brokersStore.brokers.find(b => b.id === id)?.name ?? id.slice(0, 8)
}
function queueName(id: string) {
  return queuesStore.queues.find(q => q.id === id)?.name ?? id.slice(0, 8)
}
function parsedEventTypes(raw: string): string[] {
  try { return JSON.parse(raw) as string[] } catch { return [] }
}

// Vue Flow nodes & edges
const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])

function rebuildGraph() {
  const brokerNodes: Node[] = brokersStore.brokers.map((b, i) => ({
    id: `broker-${b.id}`,
    type: 'broker',
    position: { x: 50, y: 60 + i * 140 },
    data: { label: b.name, type: b.type, status: b.status },
  }))

  const queueNodes: Node[] = queuesStore.queues.map((q, i) => ({
    id: `queue-${q.id}`,
    type: 'queue',
    position: { x: 320, y: 60 + i * 140 },
    data: { label: q.name },
  }))

  const agentNodes: Node[] = agentsStore.agents
    .filter(a => a.queueId)
    .map((a, i) => ({
      id: `agent-${a.id}`,
      type: 'agent',
      position: { x: 580, y: 60 + i * 140 },
      data: { label: a.name, status: a.status },
    }))

  const routerEdges: Edge[] = routingStore.rules.map(r => ({
    id: `edge-${r.id}`,
    source: `broker-${r.brokerId}`,
    target: `queue-${r.queueId}`,
    animated: true,
    label: parsedEventTypes(r.eventTypes ?? '').join(', ') || undefined,
    style: { stroke: '#7c3aed' },
  }))

  const agentEdges: Edge[] = agentsStore.agents
    .filter(a => a.queueId)
    .map(a => ({
      id: `agent-edge-${a.id}`,
      source: `queue-${a.queueId}`,
      target: `agent-${a.id}`,
      animated: false,
      style: { stroke: '#3b82f6' },
    }))

  nodes.value = [...brokerNodes, ...queueNodes, ...agentNodes]
  edges.value = [...routerEdges, ...agentEdges]
}

watch(
  [() => brokersStore.brokers, () => queuesStore.queues, () => agentsStore.agents, () => routingStore.rules],
  rebuildGraph,
  { deep: true, immediate: true }
)

// Add / Remove Rule
const newRule = reactive({ name: '', brokerId: '', queueId: '', eventTypes: [] as string[] })
const adding = ref(false)

async function addRule() {
  adding.value = true
  try {
    await routingStore.addRule({
      name: newRule.name || undefined,
      brokerId: newRule.brokerId,
      queueId: newRule.queueId,
      eventTypes: newRule.eventTypes.length > 0 ? newRule.eventTypes : undefined,
    })
    newRule.name = ''
    newRule.brokerId = ''
    newRule.queueId = ''
    newRule.eventTypes = []
  } finally {
    adding.value = false
  }
}

async function removeRule(id: string) {
  await routingStore.removeRule(id)
}
</script>

<style scoped>
.flow-node {
  padding: 10px 14px;
  border-radius: 8px;
  min-width: 130px;
  font-size: 12px;
}
.broker-node {
  background: #3b1f0a;
  border: 1.5px solid #f97316;
  color: #fed7aa;
}
.queue-node {
  background: #1a0a3b;
  border: 1.5px solid #7c3aed;
  color: #ddd6fe;
}
.agent-node {
  background: #0a1f3b;
  border: 1.5px solid #3b82f6;
  color: #bfdbfe;
}
.node-label {
  font-weight: 600;
  margin-bottom: 2px;
}
.node-type {
  color: #888;
  font-size: 11px;
}
.node-status {
  margin-top: 4px;
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 4px;
  display: inline-block;
}
.node-status.active,
.node-status.running {
  background: #14532d;
  color: #86efac;
}
.node-status.inactive,
.node-status.stopped {
  background: #1c1c1c;
  color: #888;
}
.node-status.error {
  background: #450a0a;
  color: #fca5a5;
}
</style>
