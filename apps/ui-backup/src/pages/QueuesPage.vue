<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <span style="font-size: 13px; color: #999;">共 {{ queuesStore.queues.length }} 個 Queue</span>
      <n-button type="primary" @click="openCreateModal">+ 新增 Queue</n-button>
    </div>

    <n-data-table
      :columns="columns"
      :data="queuesStore.queues"
      :loading="queuesStore.loading"
      :row-key="(row: Queue) => row.id"
      size="small"
    />

    <!-- Create Modal -->
    <n-modal v-model:show="modalVisible" title="新增 Queue" style="width: 440px;">
      <n-card>
        <n-form ref="formRef" :model="form" :rules="formRules" label-placement="top">
          <n-form-item label="名稱" path="name">
            <n-input v-model:value="form.name" placeholder="b2b-crm-dev" />
            <template #feedback>BullMQ queue name，建立後不可更改</template>
          </n-form-item>
          <n-form-item label="描述" path="description">
            <n-input v-model:value="form.description" placeholder="（選填）" />
          </n-form-item>
        </n-form>
        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
          <n-button @click="modalVisible = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="saveQueue">建立</n-button>
        </div>
      </n-card>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, h } from 'vue'
import {
  NDataTable, NButton, NModal, NCard, NForm, NFormItem,
  NInput, NSpace, NPopconfirm, NTag,
  useMessage,
  type DataTableColumns, type FormInst, type FormRules
} from 'naive-ui'
import { useQueuesStore } from '@/stores/queues'
import type { Queue } from '@/api/queues'

const message = useMessage()
const queuesStore = useQueuesStore()
queuesStore.fetchQueues()

const modalVisible = ref(false)
const saving = ref(false)
const formRef = ref<FormInst | null>(null)

const defaultForm = () => ({ name: '', description: '' })
const form = reactive(defaultForm())

const formRules: FormRules = {
  name: [{ required: true, message: '必填', trigger: 'blur' }],
}

function openCreateModal() {
  Object.assign(form, defaultForm())
  modalVisible.value = true
}

async function saveQueue() {
  await formRef.value?.validate()
  saving.value = true
  try {
    await queuesStore.addQueue({
      name: form.name,
      description: form.description || undefined,
    })
    modalVisible.value = false
    message.success('Queue 建立成功')
  } finally {
    saving.value = false
  }
}

async function handleDelete(queue: Queue) {
  await queuesStore.removeQueue(queue.id)
  message.success('Queue 已刪除')
}

const columns: DataTableColumns<Queue> = [
  {
    title: '名稱',
    key: 'name',
    render: (row) => h('code', { style: 'font-size: 13px;' }, row.name),
  },
  {
    title: '描述',
    key: 'description',
    render: (row) => row.description
      ? h('span', { style: 'color: #aaa; font-size: 12px;' }, row.description)
      : h('span', { style: 'color: #555; font-size: 12px;' }, '—'),
  },
  {
    title: 'ID',
    key: 'id',
    render: (row) => h('span', { style: 'font-family: monospace; font-size: 11px; color: #666;' }, row.id.slice(0, 8) + '...'),
  },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    render: (row) => h(NPopconfirm, { onPositiveClick: () => handleDelete(row) }, {
      trigger: () => h(NButton, { size: 'tiny', type: 'error' }, { default: () => '刪除' }),
      default: () => '確認刪除此 Queue？刪除後相關的 Router 和 Agent 綁定將失效。',
    }),
  },
]
</script>
