<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <span style="font-size: 13px; color: #999;">共 {{ brokersStore.brokers.length }} 個 Broker</span>
      <n-button type="primary" @click="openCreateModal">+ 新增 Broker</n-button>
    </div>

    <n-data-table
      :columns="columns"
      :data="brokersStore.brokers"
      :loading="brokersStore.loading"
      :row-key="(row: Broker) => row.id"
      size="small"
    />

    <!-- Create Modal -->
    <n-modal v-model:show="modalVisible" title="新增 Broker" style="width: 480px;">
      <n-card>
        <n-form ref="formRef" :model="form" :rules="formRules" label-placement="top">
          <n-form-item label="名稱" path="name">
            <n-input v-model:value="form.name" placeholder="my-slack-broker" />
          </n-form-item>
          <n-form-item label="類型" path="type">
            <n-select v-model:value="form.type" :options="typeOptions" @update:value="onTypeChange" />
          </n-form-item>
          <template v-if="form.type === 'slack'">
            <n-form-item label="Signing Secret" path="signingSecret">
              <n-input v-model:value="form.signingSecret" placeholder="slack signing secret" />
            </n-form-item>
            <n-divider style="margin: 8px 0;" />
            <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 8px;">Agent 執行時所需的憑證（注入至 agent .env）</n-text>
            <n-form-item v-for="v in form.requiredVars" :key="v.key" :label="v.label">
              <n-input
                v-model:value="v.value"
                :placeholder="v.placeholder"
                :type="v.secret ? 'password' : 'text'"
                show-password-on="click"
              />
            </n-form-item>
          </template>
          <template v-else-if="form.type === 'jira'">
            <n-form-item label="監聽的 Project Keys（選填）" path="projectKeys">
              <n-input v-model:value="form.projectKeys" placeholder="PROJ1, PROJ2（留空表示接收全部）" />
            </n-form-item>
            <n-form-item label="我的 Jira Account ID（選填）" path="filterAccountId">
              <n-input v-model:value="form.filterAccountId" placeholder="712020:xxxxxxxx-xxxx-xxxx" />
              <template #feedback>設定後 Worker 只會轉發指派給我、變更为我、提及我的事件</template>
            </n-form-item>
            <n-divider style="margin: 8px 0;" />
            <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 8px;">Agent 執行時所需的憑證（注入至 agent .env）</n-text>
            <n-form-item v-for="v in form.requiredVars" :key="v.key" :label="v.label">
              <n-input
                v-model:value="v.value"
                :placeholder="v.placeholder"
                :type="v.secret ? 'password' : 'text'"
                show-password-on="click"
              />
            </n-form-item>
          </template>
          <template v-else-if="form.type === 'notion'">
            <n-divider style="margin: 8px 0;" />
            <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 8px;">Agent 執行時所需的憑證（注入至 agent .env）</n-text>
            <n-form-item v-for="v in form.requiredVars" :key="v.key" :label="v.label">
              <n-input
                v-model:value="v.value"
                :placeholder="v.placeholder"
                :type="v.secret ? 'password' : 'text'"
                show-password-on="click"
              />
            </n-form-item>
          </template>
        </n-form>
        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
          <n-button @click="modalVisible = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="saveBroker">建立</n-button>
        </div>
      </n-card>
    </n-modal>

    <!-- Webhook URL Modal -->
    <n-modal v-model:show="webhookModalVisible" title="Webhook URL" style="width: 560px;">
      <n-card>
        <p style="margin-bottom: 8px; font-size: 13px; color: #999;">將此 URL 貼入 Slack / Jira / Notion 設定：</p>
        <n-input-group>
          <n-input :value="selectedWebhookUrl" readonly />
          <n-button @click="copyWebhook">複製</n-button>
        </n-input-group>
      </n-card>
    </n-modal>

    <!-- Edit Modal -->
    <n-modal v-model:show="editModalVisible" title="編輯 Broker" style="width: 480px;">
      <n-card>
        <n-form label-placement="top">
          <n-form-item label="名稱">
            <n-input v-model:value="editForm.name" />
          </n-form-item>
          <template v-if="editForm.type === 'jira'">
            <n-form-item label="監聽的 Project Keys（選填）">
              <n-input v-model:value="editForm.projectKeys" placeholder="PROJ1, PROJ2（留空表示接收全部）" />
            </n-form-item>
            <n-form-item label="我的 Jira Account ID（選填）">
              <n-input v-model:value="editForm.filterAccountId" placeholder="712020:xxxxxxxx-xxxx-xxxx" />
              <template #feedback>設定後 Worker 只會轉發指派給我、變更為我、提及我的事件</template>
            </n-form-item>
          </template>
        </n-form>
        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
          <n-button @click="editModalVisible = false">取消</n-button>
          <n-button type="primary" :loading="editSaving" @click="saveEdit">儲存</n-button>
        </div>
      </n-card>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, h } from 'vue'
import {
  NDataTable, NButton, NModal, NCard, NForm, NFormItem,
  NInput, NSelect, NSpace, NTag, NBadge, NInputGroup, NPopconfirm, NDivider, NText,
  useMessage,
  type DataTableColumns, type FormInst, type FormRules
} from 'naive-ui'
import { useBrokersStore } from '@/stores/brokers'
import type { Broker, BrokerVar } from '@/api/brokers'

const message = useMessage()
const brokersStore = useBrokersStore()
brokersStore.fetchBrokers()

// --- Modal state ---
const modalVisible = ref(false)
const saving = ref(false)
const formRef = ref<FormInst | null>(null)

const typeOptions = [
  { label: 'Slack', value: 'slack' },
  { label: 'Jira', value: 'jira' },
  { label: 'Notion', value: 'notion' },
]

// Default requiredVars schema per broker type
const defaultVarsSchema: Record<string, BrokerVar[]> = {
  jira: [
    { key: 'JIRA_URL', label: 'Jira URL', placeholder: 'https://yourcompany.atlassian.net', secret: false, value: '' },
    { key: 'JIRA_EMAIL', label: 'Email', placeholder: 'user@company.com', secret: false, value: '' },
    { key: 'JIRA_API_TOKEN', label: 'API Token', placeholder: 'ATATT...', secret: true, value: '' },
    { key: 'JIRA_ACCOUNT_ID', label: 'Account ID', placeholder: '712020:xxx-xxx', secret: false, value: '' },
  ],
  notion: [
    { key: 'NOTION_TOKEN', label: 'Integration Token', placeholder: 'ntn_...', secret: true, value: '' },
    { key: 'NOTION_DATABASE_ID', label: 'Database ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', secret: false, value: '' },
  ],
  slack: [
    { key: 'SLACK_BOT_TOKEN', label: 'Bot Token', placeholder: 'xoxb-...', secret: true, value: '' },
  ],
}

const defaultForm = () => ({
  name: '',
  type: 'slack' as 'slack' | 'jira' | 'notion',
  signingSecret: '',
  projectKeys: '',
  filterAccountId: '',
  requiredVars: defaultVarsSchema['slack'].map(v => ({ ...v })),
})
const form = reactive(defaultForm())

function onTypeChange(type: string) {
  const schema = defaultVarsSchema[type] ?? []
  form.requiredVars = schema.map(v => ({ ...v }))
  form.projectKeys = ''
  form.filterAccountId = ''
}

const formRules: FormRules = {
  name: [{ required: true, message: '必填', trigger: 'blur' }],
  type: [{ required: true, message: '必選', trigger: 'blur' }],
}

function openCreateModal() {
  Object.assign(form, defaultForm())
  modalVisible.value = true
}

async function saveBroker() {
  await formRef.value?.validate()
  saving.value = true
  try {
    const config: Record<string, string> = {}
    if (form.signingSecret) config.signing_secret = form.signingSecret
    if (form.type === 'jira') {
      if (form.projectKeys.trim()) {
        config.project_keys = form.projectKeys.split(',').map(k => k.trim()).filter(Boolean).join(',')
      }
      if (form.filterAccountId.trim()) {
        config.filter_account_id = form.filterAccountId.trim()
      }
    }

    await brokersStore.addBroker({
      name: form.name,
      type: form.type,
      config,
      requiredVars: form.requiredVars,
    })
    modalVisible.value = false
    message.success('Broker 建立成功')
  } finally {
    saving.value = false
  }
}

// --- Edit ---
const editModalVisible = ref(false)
const editSaving = ref(false)
const editingBrokerId = ref<string | null>(null)
const editForm = reactive({ name: '', type: '' as string, projectKeys: '', filterAccountId: '' })

function openEditModal(broker: Broker) {
  editingBrokerId.value = broker.id
  editForm.name = broker.name
  editForm.type = broker.type
  const config = broker.config ? JSON.parse(broker.config) as Record<string, string> : {}
  editForm.projectKeys = config.project_keys ?? ''
  editForm.filterAccountId = config.filter_account_id ?? ''
  editModalVisible.value = true
}

async function saveEdit() {
  if (!editingBrokerId.value) return
  editSaving.value = true
  try {
    const patch: { name?: string; config?: Record<string, string> } = {}
    if (editForm.name) patch.name = editForm.name
    if (editForm.type === 'jira') {
      patch.config = {
        project_keys: editForm.projectKeys.split(',').map(k => k.trim()).filter(Boolean).join(','),
        filter_account_id: editForm.filterAccountId.trim(),
      }
    }
    await brokersStore.patchBroker(editingBrokerId.value, patch)
    editModalVisible.value = false
    message.success('Broker 已更新')
  } finally {
    editSaving.value = false
  }
}

// --- Webhook URL ---
const webhookModalVisible = ref(false)
const selectedWebhookUrl = ref('')

function showWebhook(broker: Broker) {
  selectedWebhookUrl.value = broker.webhookUrl
  webhookModalVisible.value = true
}

function copyWebhook() {
  navigator.clipboard.writeText(selectedWebhookUrl.value)
  message.success('已複製')
}

// --- Activate / Deactivate ---
const actionLoading = reactive<Record<string, boolean>>({})

async function toggleBroker(broker: Broker) {
  actionLoading[broker.id] = true
  try {
    if (broker.status === 'active') {
      await brokersStore.deactivate(broker.id)
    } else {
      await brokersStore.activate(broker.id)
    }
  } finally {
    actionLoading[broker.id] = false
  }
}

async function handleDelete(broker: Broker) {
  await brokersStore.removeBroker(broker.id)
}

function statusType(status: string): 'success' | 'error' | 'warning' | 'default' {
  if (status === 'active') return 'success'
  if (status === 'error') return 'error'
  return 'default'
}

const columns: DataTableColumns<Broker> = [
  { title: '名稱', key: 'name', render: (row) => h('strong', row.name) },
  {
    title: '類型',
    key: 'type',
    width: 80,
    render: (row) => h(NTag, { size: 'small', type: row.type === 'slack' ? 'info' : row.type === 'notion' ? 'success' : 'warning', bordered: false }, { default: () => row.type }),
  },
  {
    title: '狀態',
    key: 'status',
    width: 90,
    render: (row) => h(NBadge, { type: statusType(row.status), dot: true, offset: [4, 0] }, { default: () => row.status }),
  },
  {
    title: 'Webhook URL',
    key: 'webhookUrl',
    render: (row) => h(NButton, { size: 'tiny', text: true, onClick: () => showWebhook(row) }, { default: () => '查看 URL' }),
  },
  {
    title: 'Queue ID',
    key: 'queueId',
    render: (row) => row.queueId
      ? h('span', { style: 'font-family: monospace; font-size: 11px; color: #888;' }, row.queueId)
      : h('span', { style: 'color: #ccc; font-size: 11px;' }, '—'),
  },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    render: (row) => h(NSpace, { size: 'small' }, {
      default: () => [
        h(NButton, {
          size: 'tiny',
          onClick: () => openEditModal(row),
        }, { default: () => '編輯' }),
        h(NButton, {
          size: 'tiny',
          type: row.status === 'active' ? 'warning' : 'primary',
          loading: actionLoading[row.id],
          onClick: () => toggleBroker(row),
        }, { default: () => row.status === 'active' ? '停用' : '啟用' }),
        h(NPopconfirm, { onPositiveClick: () => handleDelete(row) }, {
          trigger: () => h(NButton, { size: 'tiny', type: 'error' }, { default: () => '刪除' }),
          default: () => '確認刪除此 Broker？',
        }),
      ],
    }),
  },
]
</script>
