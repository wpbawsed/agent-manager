<template>
  <div style="padding:24px;">
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Workflow Runs</div>
          <div class="card-sub">等待人工的排最上面</div>
        </div>
        <div style="display:flex; gap:8px;">
          <select v-model="workflowId" class="form-select" style="width:200px;">
            <option value="">全部 Workflow</option>
            <option v-for="w in workflows.workflows" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
          <select v-model="status" class="form-select" style="width:160px;">
            <option value="">全部狀態</option>
            <option v-for="s in statuses" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </div>
      </div>
      <div v-if="loading && !runs.length" class="empty">載入中...</div>
      <div v-else-if="!runs.length" class="empty">沒有符合的 Run</div>
      <table v-else>
        <thead>
          <tr>
            <th>Workflow</th>
            <th>狀態</th>
            <th>目前節點</th>
            <th>步數</th>
            <th>開始</th>
            <th>最後更新</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in runs" :key="r.id" class="row-link" @click="router.push(`/workflow-runs/${r.id}`)">
            <td>
              <div style="font-weight:500;">{{ r.workflowName }}</div>
              <div class="agent-id">{{ r.id.slice(0, 8) }} · v{{ r.version ?? '–' }}</div>
            </td>
            <td><RunStatusBadge :status="r.status" /></td>
            <td><span class="mono">{{ r.currentNode ?? '—' }}</span></td>
            <td>{{ r.steps }}</td>
            <td style="font-size:12px; color:var(--text2);">{{ fmtTime(r.createdAt) }}</td>
            <td style="font-size:12px; color:var(--text2);">{{ fmtTime(r.updatedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { runsApi } from '@/api'
import RunStatusBadge from '@/components/RunStatusBadge.vue'
import { useWorkflowsStore, type RunSummary } from '@/stores/workflows'
import { fmtTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const workflows = useWorkflowsStore()

const statuses = [
  { value: 'interrupted', label: '等待人工' },
  { value: 'running', label: '執行中' },
  { value: 'done', label: '完成' },
  { value: 'failed', label: '失敗' },
  { value: 'cancelled', label: '已取消' },
]
const runs = ref<RunSummary[]>([])
const loading = ref(false)
const workflowId = ref(typeof route.query.workflowId === 'string' ? route.query.workflowId : '')
const status = ref(typeof route.query.status === 'string' ? route.query.status : '')

async function load() {
  loading.value = true
  try {
    const { data } = await runsApi.list({ workflowId: workflowId.value || undefined, status: status.value || undefined, limit: 100 })
    runs.value = data
  } finally {
    loading.value = false
  }
}

watch([workflowId, status], () => {
  router.replace({ query: { ...(workflowId.value && { workflowId: workflowId.value }), ...(status.value && { status: status.value }) } })
  load()
})
// The URL can change underneath us too (sidebar "Runs" clears the query, browser back).
watch(
  () => route.query,
  (q) => {
    workflowId.value = typeof q.workflowId === 'string' ? q.workflowId : ''
    status.value = typeof q.status === 'string' ? q.status : ''
  },
)

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  workflows.fetch()
  load()
  timer = setInterval(load, 10_000)
})
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.row-link { cursor: pointer; }
.row-link:hover td { background: var(--surface2); }
.mono { font-family: ui-monospace, monospace; font-size: 12px; }
</style>
