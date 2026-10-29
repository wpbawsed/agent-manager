<template>
  <div class="wf-page">
    <!-- Workflow list -->
    <aside class="wf-list">
      <div class="wf-list-head">
        <span class="card-title">Workflows</span>
        <button class="btn btn-primary btn-sm" @click="startNew">+ New</button>
      </div>
      <div v-if="workflows.loading" class="empty">載入中...</div>
      <div v-else-if="!workflows.workflows.length && !draft" class="empty">尚無 Workflow</div>
      <div
        v-for="w in workflows.workflows"
        :key="w.id"
        class="wf-item"
        :class="{ active: currentId === w.id }"
        @click="open(w.id)"
      >
        <div class="wf-item-name">{{ w.name }}</div>
        <div class="wf-item-sub">v{{ w.version ?? '–' }} · {{ triggersOf(w.id).length }} 個觸發規則</div>
      </div>
    </aside>

    <!-- Editor -->
    <section v-if="draft" class="wf-editor">
      <div class="wf-toolbar">
        <input v-model="draft.name" class="form-input wf-name" placeholder="Workflow 名稱" @input="dirty = true" />
        <span v-if="currentVersion" class="wf-version">v{{ currentVersion }}</span>
        <label class="wf-max">
          maxSteps
          <input v-model.number="draft.graph.maxSteps" type="number" min="1" max="100" class="form-input" @input="dirty = true" />
        </label>
        <div class="wf-toolbar-spacer" />
        <router-link v-if="currentId" :to="`/workflow-runs?workflowId=${currentId}`" class="btn btn-ghost btn-sm">Runs</router-link>
        <button v-if="currentId" class="btn btn-danger btn-sm" @click="remove">Delete</button>
        <button class="btn btn-primary btn-sm" :disabled="saving || (!dirty && !!currentId)" @click="save">
          {{ saving ? '儲存中...' : currentId ? '儲存為新版本' : '建立' }}
        </button>
      </div>
      <div v-if="error" class="alert alert-error wf-alert">
        {{ error }}
        <ul v-if="errorDetails.length"><li v-for="d in errorDetails" :key="d">{{ d }}</li></ul>
      </div>

      <div class="wf-body">
        <div class="wf-canvas-wrap">
          <div v-if="!draft.graph.nodes.length" class="wf-hint">從右邊加入第一個節點（選一個 agent）</div>
          <WorkflowGraphView
            v-else
            :graph="draft.graph"
            :agent-names="agentNames"
            :selected="selected"
            editable
            @select="selected = $event"
            @connect="onConnect"
            @move="onMove"
          />
        </div>

        <!-- Side panel -->
        <aside class="wf-panel">
          <!-- Node -->
          <template v-if="selectedNode">
            <div class="panel-title">節點 <span class="mono">{{ selectedNode.id }}</span></div>
            <div class="form-group">
              <label class="form-label">ID</label>
              <input :value="selectedNode.id" class="form-input mono" @change="renameNode($event.target as HTMLInputElement)" />
              <div class="form-hint">英文字母開頭，只能用英數、- 與 _</div>
            </div>
            <div class="form-group">
              <label class="form-label">Agent</label>
              <select v-model="selectedNode.agentId" class="form-select" @change="dirty = true">
                <option v-for="a in agents.agents" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">輸入範本</label>
              <textarea v-model="selectedNode.input" class="form-textarea mono" rows="6" @input="dirty = true" />
              <div class="form-hint">
                <code v-pre>{{input.text}}</code>、<code v-pre>{{input.raw.comment.body}}</code>：觸發事件；
                <code v-pre>{{nodes.&lt;id&gt;.summary}}</code>（或 mrUrl／label）：前面節點的結果；
                <code v-pre>{{human}}</code>：人工回覆
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">結論標籤（選填，逗號分隔）</label>
              <input :value="(selectedNode.labels ?? []).join(', ')" class="form-input" placeholder="approve, changes" @change="setLabels(($event.target as HTMLInputElement).value)" />
              <div class="form-hint">設了就會要求 agent 在回覆最後寫「結論：&lt;標籤&gt;」，邊可以依標籤分岔</div>
            </div>
            <label class="check">
              <input v-model="selectedNode.interruptBefore" type="checkbox" @change="dirty = true" />
              執行前停下來等人工放行
            </label>
            <div class="panel-actions">
              <button class="btn btn-ghost btn-sm" :disabled="draft.graph.entry === selectedNode.id" @click="setEntry(selectedNode.id)">
                {{ draft.graph.entry === selectedNode.id ? '起點' : '設為起點' }}
              </button>
              <button class="btn btn-danger btn-sm" @click="removeNode(selectedNode.id)">刪除節點</button>
            </div>
          </template>

          <!-- Edge -->
          <template v-else-if="selectedEdge">
            <div class="panel-title">邊 <span class="mono">{{ selectedEdge.from }} → {{ selectedEdge.to }}</span></div>
            <div class="form-hint" style="margin-bottom:12px;">同一個節點出去的邊照順序比對，第一個符合的就走；都不符合時，成功走到 END、失敗則 Run 失敗。</div>
            <div class="form-group">
              <label class="form-label">結果</label>
              <select :value="selectedEdge.when?.status ?? ''" class="form-select" @change="setWhen('status', ($event.target as HTMLSelectElement).value)">
                <option value="">不限</option>
                <option value="done">成功</option>
                <option value="failed">失敗</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">有沒有 PR／MR</label>
              <select :value="selectedEdge.when?.hasMrUrl === undefined ? '' : String(selectedEdge.when.hasMrUrl)" class="form-select" @change="setWhen('hasMrUrl', ($event.target as HTMLSelectElement).value)">
                <option value="">不限</option>
                <option value="true">有</option>
                <option value="false">沒有</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">結論標籤</label>
              <select :value="selectedEdge.when?.label ?? ''" class="form-select" :disabled="!fromLabels.length" @change="setWhen('label', ($event.target as HTMLSelectElement).value)">
                <option value="">不限</option>
                <option v-for="l in fromLabels" :key="l" :value="l">{{ l }}</option>
              </select>
              <div v-if="!fromLabels.length" class="form-hint">「{{ selectedEdge.from }}」沒有設結論標籤</div>
            </div>
            <div class="panel-actions">
              <button class="btn btn-ghost btn-sm" @click="moveEdge(-1)">↑ 優先</button>
              <button class="btn btn-ghost btn-sm" @click="moveEdge(1)">↓ 延後</button>
              <button class="btn btn-danger btn-sm" @click="removeEdge">刪除邊</button>
            </div>
          </template>

          <!-- Nothing selected -->
          <template v-else>
            <div class="panel-title">加入節點</div>
            <div class="form-group">
              <select v-model="newAgentId" class="form-select">
                <option value="">— 選一個 agent —</option>
                <option v-for="a in agents.agents" :key="a.id" :value="a.id">{{ a.name }}{{ a.queueId ? '' : '（沒綁 queue）' }}</option>
              </select>
            </div>
            <button class="btn btn-primary btn-sm" :disabled="!newAgentId" @click="addNode">+ 加入</button>
            <div class="form-hint" style="margin-top:12px;">
              從節點右側拖到另一個節點（或 END）就是一條邊；從 START 拖出去是設定起點。點節點或邊可以編輯。
            </div>

            <div class="panel-title" style="margin-top:24px;">觸發</div>
            <div v-if="!currentId" class="form-hint">建立後，到 Routing 新增一條目標是這個 Workflow 的規則。</div>
            <template v-else>
              <div v-if="!triggersOf(currentId).length" class="form-hint">
                還沒有規則指向這個 Workflow。到 <router-link to="/routing">Routing</router-link> 新增，目標選這個 Workflow。
              </div>
              <div v-for="r in triggersOf(currentId)" :key="r.id" class="trigger">
                <div>{{ r.name || brokerName(r.brokerId) }}</div>
                <div class="form-hint">
                  {{ brokerName(r.brokerId) }} ·
                  {{ routing.eventTypesList(r).length ? routing.eventTypesList(r).join(', ') : 'catch-all' }}
                </div>
              </div>
            </template>
          </template>
        </aside>
      </div>
    </section>

    <section v-else class="wf-editor wf-empty">
      <div class="empty">選一個 Workflow，或按 + New 建立</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { workflowsApi } from '@/api'
import WorkflowGraphView, { type Selection } from '@/components/WorkflowGraphView.vue'
import { END, useWorkflowsStore, type WorkflowDetail, type WorkflowGraph, type EdgeWhen } from '@/stores/workflows'
import { useAgentsStore } from '@/stores/agents'
import { useRoutingStore } from '@/stores/routing'
import { useBrokersStore } from '@/stores/brokers'

const workflows = useWorkflowsStore()
const agents = useAgentsStore()
const routing = useRoutingStore()
const brokers = useBrokersStore()
const route = useRoute()
const router = useRouter()

const currentId = ref<string | null>(null)
const currentVersion = ref<number | null>(null)
const draft = ref<{ name: string; graph: WorkflowGraph } | null>(null)
const dirty = ref(false)
const saving = ref(false)
const error = ref('')
const errorDetails = ref<string[]>([])
const selected = ref<Selection>(null)
const newAgentId = ref('')

const agentNames = computed(() => Object.fromEntries(agents.agents.map((a) => [a.id, a.name])))
const selectedNode = computed(() =>
  selected.value?.kind === 'node' ? draft.value?.graph.nodes.find((n) => n.id === (selected.value as { id: string }).id) : undefined,
)
const selectedEdge = computed(() =>
  selected.value?.kind === 'edge' ? draft.value?.graph.edges[(selected.value as { index: number }).index] : undefined,
)
const fromLabels = computed(() => draft.value?.graph.nodes.find((n) => n.id === selectedEdge.value?.from)?.labels ?? [])

const triggersOf = (workflowId: string) => routing.rules.filter((r) => r.workflowId === workflowId)
const brokerName = (id: string) => brokers.brokers.find((b) => b.id === id)?.name ?? id.slice(0, 8)

function confirmDiscard() {
  return !dirty.value || confirm('有未儲存的修改，確定放棄？')
}

// Leaving the page (sidebar, Runs / Routing links) or closing the tab with unsaved edits asks first.
onBeforeRouteLeave(() => confirmDiscard())
const beforeUnload = (e: BeforeUnloadEvent) => {
  if (dirty.value) e.preventDefault()
}
window.addEventListener('beforeunload', beforeUnload)
onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload))

let openSeq = 0 // only the latest open() may apply its response
async function open(id: string) {
  if (id === currentId.value) return
  if (!confirmDiscard()) {
    // keep the URL on what's actually shown
    router.replace({ query: currentId.value ? { id: currentId.value } : {} })
    return
  }
  const seq = ++openSeq
  const { data } = await workflowsApi.get(id)
  if (seq !== openSeq) return
  const wf = data as WorkflowDetail
  currentId.value = wf.id
  currentVersion.value = wf.version
  draft.value = { name: wf.name, graph: structuredClone(wf.graph ?? { entry: '', nodes: [], edges: [] }) }
  dirty.value = false
  selected.value = null
  error.value = ''
  errorDetails.value = []
  if (route.query.id !== id) router.replace({ query: { id } })
}

function startNew() {
  if (!confirmDiscard()) return
  currentId.value = null
  currentVersion.value = null
  draft.value = { name: '', graph: { entry: '', maxSteps: 10, nodes: [], edges: [] } }
  dirty.value = true
  selected.value = null
  router.replace({ query: {} })
}

function uniqueId(base: string) {
  const ids = new Set(draft.value!.graph.nodes.map((n) => n.id))
  let id = base.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^[^a-zA-Z]+/, '') || 'node'
  if (!ids.has(id)) return id
  for (let i = 2; ; i++) if (!ids.has(`${id}${i}`)) return `${id}${i}`
}

function addNode() {
  const g = draft.value!.graph
  const id = uniqueId(agentNames.value[newAgentId.value] ?? 'node')
  g.nodes.push({ id, agentId: newAgentId.value, input: g.nodes.length ? `{{nodes.${g.nodes[g.nodes.length - 1].id}.summary}}` : '{{input.text}}' })
  if (!g.entry) g.entry = id
  newAgentId.value = ''
  selected.value = { kind: 'node', id }
  dirty.value = true
}

const NODE_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/ // same rule as the API (workflow/graph.ts)

function renameNode(input: HTMLInputElement) {
  const g = draft.value!.graph
  const node = selectedNode.value
  const next = input.value.trim()
  if (!node || next === node.id) return
  const problem = !NODE_ID.test(next)
    ? `節點 ID「${next}」不合法：英文字母開頭，只能用英數、- 與 _`
    : g.nodes.some((n) => n.id === next) || next === END
      ? `節點 ID「${next}」已存在或是保留字`
      : ''
  if (problem) {
    error.value = problem
    input.value = node.id // the field shows what's actually there
    return
  }
  error.value = ''
  const prev = node.id
  node.id = next
  for (const e of g.edges) {
    if (e.from === prev) e.from = next
    if (e.to === prev) e.to = next
  }
  if (g.entry === prev) g.entry = next
  for (const n of g.nodes) n.input = n.input.split(`nodes.${prev}.`).join(`nodes.${next}.`)
  selected.value = { kind: 'node', id: next }
  dirty.value = true
}

function setLabels(text: string) {
  const node = selectedNode.value!
  const labels = text.split(',').map((s) => s.trim()).filter(Boolean)
  node.labels = labels.length ? labels : undefined
  // drop edge conditions that point at labels that no longer exist
  for (const e of draft.value!.graph.edges) {
    if (e.from === node.id && e.when?.label && !labels.includes(e.when.label)) delete e.when.label
  }
  dirty.value = true
}

function setEntry(id: string) {
  draft.value!.graph.entry = id
  dirty.value = true
}

function removeNode(id: string) {
  const g = draft.value!.graph
  g.nodes = g.nodes.filter((n) => n.id !== id)
  g.edges = g.edges.filter((e) => e.from !== id && e.to !== id)
  if (g.entry === id) g.entry = g.nodes[0]?.id ?? ''
  selected.value = null
  dirty.value = true
}

function onConnect(from: string, to: string) {
  const g = draft.value!.graph
  if (from === '') {
    if (to !== END) setEntry(to)
    return
  }
  g.edges.push({ from, to })
  selected.value = { kind: 'edge', index: g.edges.length - 1 }
  dirty.value = true
}

function onMove(id: string, position: { x: number; y: number }) {
  const node = draft.value?.graph.nodes.find((n) => n.id === id)
  if (!node) return
  node.position = position
  dirty.value = true
}

function setWhen(key: keyof EdgeWhen, value: string) {
  const e = selectedEdge.value!
  const when: EdgeWhen = { ...(e.when ?? {}) }
  if (value === '') delete when[key]
  else if (key === 'hasMrUrl') when.hasMrUrl = value === 'true'
  else if (key === 'status') when.status = value as 'done' | 'failed'
  else when.label = value
  e.when = Object.keys(when).length ? when : undefined
  dirty.value = true
}

function moveEdge(delta: number) {
  const g = draft.value!.graph
  const i = (selected.value as { index: number }).index
  const from = g.edges[i].from
  // swap with the previous / next edge leaving the same node — that's the order that matters
  let j = i + delta
  while (j >= 0 && j < g.edges.length && g.edges[j].from !== from) j += delta
  if (j < 0 || j >= g.edges.length) return
  ;[g.edges[i], g.edges[j]] = [g.edges[j], g.edges[i]]
  selected.value = { kind: 'edge', index: j }
  dirty.value = true
}

function removeEdge() {
  draft.value!.graph.edges.splice((selected.value as { index: number }).index, 1)
  selected.value = null
  dirty.value = true
}

async function save() {
  if (!draft.value) return
  error.value = ''
  errorDetails.value = []
  if (!draft.value.name.trim()) {
    error.value = '請填 Workflow 名稱'
    return
  }
  saving.value = true
  try {
    const graph = { ...draft.value.graph, maxSteps: draft.value.graph.maxSteps || undefined }
    if (currentId.value) {
      const { data } = await workflowsApi.update(currentId.value, { name: draft.value.name, graph })
      currentVersion.value = data.version
    } else {
      const { data } = await workflowsApi.create({ name: draft.value.name, graph })
      currentId.value = data.id
      currentVersion.value = data.version
      router.replace({ query: { id: data.id } })
    }
    dirty.value = false
    await workflows.fetch()
  } catch (e: unknown) {
    const d = (e as { response?: { data?: { error?: string; details?: string[] } } }).response?.data
    error.value = d?.error ?? '儲存失敗'
    errorDetails.value = d?.details ?? []
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!currentId.value || !confirm(`確定刪除「${draft.value?.name}」？已有的 Run 紀錄會一起刪除。`)) return
  try {
    await workflowsApi.delete(currentId.value)
    currentId.value = null
    draft.value = null
    dirty.value = false
    router.replace({ query: {} })
    await workflows.fetch()
  } catch (e: unknown) {
    const res = (e as { response?: { status?: number; data?: { error?: string } } }).response
    error.value = res?.status === 409
      ? '還有路由規則指向這個 Workflow。先到 Routing 刪掉那條規則或改目標，再刪除。'
      : res?.data?.error ?? '刪除失敗'
  }
}

watch(
  () => route.query.id,
  (id) => {
    if (typeof id === 'string' && id !== currentId.value) open(id)
  },
)

onMounted(async () => {
  await Promise.all([workflows.fetch(), agents.fetch(), routing.fetch(), brokers.fetch()])
  if (typeof route.query.id === 'string') open(route.query.id)
})
</script>

<style scoped>
.wf-page { display: flex; height: 100%; }
.wf-list { width: 240px; border-right: 1px solid var(--border); overflow-y: auto; flex-shrink: 0; }
.wf-list-head { display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid var(--border); }
.wf-item { padding: 12px 16px; border-bottom: 1px solid var(--border); cursor: pointer; }
.wf-item:hover { background: var(--surface2); }
.wf-item.active { background: var(--accent-bg); }
.wf-item-name { font-weight: 500; font-size: 13.5px; }
.wf-item-sub { font-size: 11px; color: var(--text3); margin-top: 2px; }
.wf-editor { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.wf-empty { align-items: center; justify-content: center; }
.wf-toolbar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
.wf-name { max-width: 280px; }
.wf-version { font-size: 12px; color: var(--text3); }
.wf-max { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text2); }
.wf-max input { width: 64px; }
.wf-toolbar-spacer { flex: 1; }
.wf-alert { margin: 10px 16px 0; }
.wf-alert ul { margin: 6px 0 0 18px; }
.wf-body { flex: 1; display: flex; min-height: 0; }
.wf-canvas-wrap { flex: 1; position: relative; min-width: 0; }
.wf-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text3); }
.wf-panel { width: 320px; border-left: 1px solid var(--border); padding: 16px; overflow-y: auto; flex-shrink: 0; }
.panel-title { font-weight: 600; font-size: 13px; margin-bottom: 12px; }
.panel-actions { display: flex; gap: 6px; margin-top: 14px; flex-wrap: wrap; }
.check { display: flex; gap: 6px; align-items: center; font-size: 13px; cursor: pointer; }
.trigger { padding: 8px 10px; border: 1px solid var(--border2); border-radius: var(--radius); margin-bottom: 6px; font-size: 13px; }
.mono { font-family: ui-monospace, monospace; }
</style>
