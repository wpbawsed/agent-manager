<template>
  <div>
    <n-page-header title="Admin — 帳號管理" style="margin-bottom: 20px;" />

    <n-card>
      <n-data-table
        :columns="columns"
        :data="users"
        :loading="loading"
        :row-key="row => row.id"
        size="small"
      />
    </n-card>

    <!-- Edit Role Modal -->
    <n-modal v-model:show="showEditModal" preset="dialog" title="修改帳號">
      <n-form ref="formRef" :model="editForm" label-placement="left" label-width="80px" style="margin-top: 12px;">
        <n-form-item label="Email">
          <n-input :value="editForm.email" disabled />
        </n-form-item>
        <n-form-item label="角色">
          <n-select v-model:value="editForm.role" :options="roleOptions" />
        </n-form-item>
        <n-form-item label="新密碼">
          <n-input v-model:value="editForm.password" type="password" placeholder="留空表示不變更" show-password-on="click" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-button @click="showEditModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveUser">儲存</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, h, onMounted } from 'vue'
import {
  NPageHeader, NCard, NDataTable, NModal, NForm, NFormItem,
  NInput, NButton, NSelect, NTag, NPopconfirm, NSpace,
  useMessage,
  type DataTableColumns
} from 'naive-ui'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api/auth'

interface AdminUser {
  id: string
  email: string
  role: string
  createdAt: number
}

const authStore = useAuthStore()
const message = useMessage()

const users = ref<AdminUser[]>([])
const loading = ref(false)
const saving = ref(false)
const showEditModal = ref(false)
const editForm = ref({ id: '', email: '', role: 'owner', password: '' })

const roleOptions = [
  { label: 'owner', value: 'owner' },
  { label: 'admin', value: 'admin' },
]

async function fetchUsers() {
  loading.value = true
  try {
    const res = await api.get<{ users: AdminUser[] }>('/admin/users')
    users.value = res.data.users
  } catch {
    message.error('載入失敗')
  } finally {
    loading.value = false
  }
}

function openEdit(row: AdminUser) {
  editForm.value = { id: row.id, email: row.email, role: row.role, password: '' }
  showEditModal.value = true
}

async function saveUser() {
  saving.value = true
  try {
    const payload: Record<string, string> = { role: editForm.value.role }
    if (editForm.value.password) payload.password = editForm.value.password
    await api.patch(`/admin/users/${editForm.value.id}`, payload)
    message.success('已更新')
    showEditModal.value = false
    await fetchUsers()
  } catch {
    message.error('更新失敗')
  } finally {
    saving.value = false
  }
}

async function deleteUser(id: string) {
  try {
    await api.delete(`/admin/users/${id}`)
    message.success('已刪除')
    await fetchUsers()
  } catch {
    message.error('刪除失敗')
  }
}

const columns: DataTableColumns<AdminUser> = [
  { title: 'Email', key: 'email' },
  {
    title: '角色',
    key: 'role',
    render: row => h(NTag, { type: row.role === 'admin' ? 'error' : 'info', size: 'small' }, () => row.role),
  },
  {
    title: '建立時間',
    key: 'createdAt',
    render: row => new Date(row.createdAt).toLocaleString('zh-TW'),
  },
  {
    title: '操作',
    key: 'actions',
    render: row => {
      const isSelf = row.id === authStore.user?.id
      return h(NSpace, { size: 'small' }, () => [
        h(NButton, { size: 'tiny', onClick: () => openEdit(row) }, () => '編輯'),
        !isSelf
          ? h(
              NPopconfirm,
              { onPositiveClick: () => deleteUser(row.id) },
              {
                default: () => `確定刪除 ${row.email}？`,
                trigger: () => h(NButton, { size: 'tiny', type: 'error' }, () => '刪除'),
              }
            )
          : null,
      ])
    },
  },
]

onMounted(fetchUsers)
</script>
