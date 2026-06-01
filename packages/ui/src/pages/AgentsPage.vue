<template>
  <div>
    <!-- Header Bar -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <n-space align="center">
        <n-statistic label="總計" :value="agentsStore.agents.length" />
        <n-statistic
          label="執行中"
          :value="agentsStore.agents.filter(a => a.status === 'running').length"
        />
      </n-space>
      <n-button type="primary" @click="openCreateDrawer">
        + 新增 Agent
      </n-button>
    </div>

    <!-- Agent Table -->
    <n-data-table
      :columns="columns"
      :data="agentsStore.agents"
      :loading="agentsStore.loading"
      :row-key="(row: Agent) => row.id"
      size="small"
    />

    <!-- Create Drawer -->
    <n-drawer v-model:show="drawerVisible" :width="520" placement="right">
      <n-drawer-content title="新增 Agent" closable>
        <n-form ref="formRef" :model="form" :rules="formRules" label-placement="top">
          <n-form-item label="名稱" path="name">
            <n-input v-model:value="form.name" placeholder="my-agent" />
          </n-form-item>
          <n-form-item label="Queue（選填，啟動後從此 Queue 接收任務）" path="queueId">
            <n-select
              v-model:value="form.queueId"
              :options="queueOptions"
              clearable
              placeholder="選擇 Queue"
            />
          </n-form-item>
          <n-form-item label="Instruction（選填）" path="instruction">
            <n-input
              v-model:value="form.instruction"
              type="textarea"
              placeholder="你是一個全端開發 Agent，收到 Jira 任務後自動實作並發 PR..."
              :autosize="{ minRows: 4, maxRows: 8 }"
            />
          </n-form-item>
        </n-form>
        <template #footer>
          <n-space justify="end">
            <n-button @click="drawerVisible = false">取消</n-button>
            <n-button type="primary" :loading="saving" @click="saveAgent">建立</n-button>
          </n-space>
        </template>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, h } from 'vue'
import { useRouter } from 'vue-router'
import {
  NDataTable, NButton, NDrawer, NDrawerContent, NForm, NFormItem,
  NInput, NSelect, NSpace, NStatistic,
  NPopconfirm, NTag, NBadge,
  type DataTableColumns, type FormInst, type FormRules
} from 'naive-ui'
import { useAgentsStore } from '@/stores/agents'
import { useQueuesStore } from '@/stores/queues'
import type { Agent } from '@/api/agents'

const router = useRouter()
const agentsStore = useAgentsStore()
const queuesStore = useQueuesStore()
agentsStore.fetchAgents()
queuesStore.fetchQueues()

// --- Create Drawer State ---
const drawerVisible = ref(false)
const saving = ref(false)
const formRef = ref<FormInst | null>(null)

const queueOptions = computed(() =>
  queuesStore.queues.map(q => ({ label: q.name, value: q.id }))
)

const defaultForm = () => ({ name: '', queueId: null as string | null, instruction: '' })
const form = reactive(defaultForm())

const formRules: FormRules = {
  name: [{ required: true, message: '必填', trigger: 'blur' }],
}

function openCreateDrawer() {
  Object.assign(form, defaultForm())
  drawerVisible.value = true
}

async function saveAgent() {
  await formRef.value?.validate()
  saving.value = true
  try {
    await agentsStore.addAgent({
      name: form.name,
      queueId: form.queueId || undefined,
      instruction: form.instruction || undefined,
    })
    drawerVisible.value = false
  } finally {
    saving.value = false
  }
}

// --- Start / Stop ---
const actionLoading = reactive<Record<string, boolean>>({})

async function handleStart(agent: Agent) {
  actionLoading[agent.id] = true
  try { await agentsStore.start(agent.id) } finally { actionLoading[agent.id] = false }
}

async function handleStop(agent: Agent) {
  actionLoading[agent.id] = true
  try { await agentsStore.stop(agent.id) } finally { actionLoading[agent.id] = false }
}

// --- Status Badge ---
function statusType(status: string): 'success' | 'error' | 'warning' | 'default' {
  if (status === 'running') return 'success'
  if (status === 'error') return 'error'
  return 'default'
}

// --- Table Columns ---
const columns: DataTableColumns<Agent> = [
  {
    title: '名稱',
    key: 'name',
    render: (row) => h('strong', row.name),
  },
  {
    title: 'Queue',
    key: 'queueId',
    width: 140,
    render: (row) => {
      const q = queuesStore.queues.find(q => q.id === row.queueId)
      return q ? h(NTag, { size: 'small', bordered: false, type: 'info' }, { default: () => q.name }) : h('span', { style: 'color:#555' }, '—')
    },
  },
  {
    title: '狀態',
    key: 'status',
    width: 90,
    render: (row) => h(NBadge, { type: statusType(row.status), dot: true, offset: [4, 0] }, { default: () => row.status }),
  },
  {
    title: 'Instruction',
    key: 'instruction',
    ellipsis: true,
    render: (row) => row.instruction ? h('span', { style: 'color:#aaa;font-size:12px' }, row.instruction.slice(0, 60) + (row.instruction.length > 60 ? '…' : '')) : '—',
  },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    render: (row) => h(NSpace, { size: 'small' }, {
      default: () => [
        row.status === 'running'
          ? h(NPopconfirm, { onPositiveClick: () => handleStop(row) }, {
              trigger: () => h(NButton, { size: 'tiny', type: 'warning', loading: actionLoading[row.id] }, { default: () => '停止' }),
              default: () => '確認停止此 Agent？',
            })
          : h(NButton, {
              size: 'tiny', type: 'primary', loading: actionLoading[row.id],
              onClick: () => handleStart(row),
            }, { default: () => '啟動' }),
        h(NButton, {
          size: 'tiny', secondary: true,
          onClick: () => router.push(`/agents/${row.id}/detail`),
        }, { default: () => '詳細' }),
      ],
    }),
  },
]
</script>
