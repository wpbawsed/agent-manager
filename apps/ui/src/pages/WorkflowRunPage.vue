<template>
  <div class="run-page">
    <div v-if="!run" class="empty">{{ notFound ? '找不到這個 Run' : '載入中...' }}</div>
    <template v-else>
      <div class="run-head">
        <router-link :to="`/workflow-runs?workflowId=${run.workflowId}`" class="back">← Runs</router-link>
        <div class="run-title">
          <router-link :to="`/workflows?id=${run.workflowId}`">{{ workflowName }}</router-link>
          <span class="run-sub">v{{ run.version ?? '–' }} · {{ run.id.slice(0, 8) }} · {{ fmtTime(run.createdAt) }}</span>
        </div>
        <RunStatusBadge :status="run.status" />
        <span class="run-sub">步數 {{ run.stepCount }}{{ run.graph?.maxSteps ? ` / ${run.graph.maxSteps}` : '' }} · 成本 {{ fmtCost(totalCost) }}</span>
        <div style="flex:1;" />
        <button v-if="run.status === 'running' || run.status === 'interrupted'" class="btn btn-danger btn-sm" :disabled="busy" @click="cancel">取消 Run</button>
      </div>

      <div v-if="run.error" class="alert alert-error run-alert">{{ run.error }}</div>

      <!-- Needs a human -->
      <div v-if="run.status === 'interrupted'" class="card human">
        <div class="card-title">⏸ 等待人工：{{ run.currentNode }}</div>
        <div v-if="waitingGate" class="form-hint">這個節點設了「執行前停下來」。看過前面的結果後放行，也可以附一段話給它。</div>
        <template v-else-if="blocked.length">
          <div class="form-hint">agent 在無人值守時碰到沒放行的動作，被擋下了：</div>
          <ul class="blocked">
            <li v-for="(b, i) in blocked" :key="i"><span class="mono">{{ b.tool }}</span>：{{ b.summary }}</li>
          </ul>
          <div class="form-hint">
            真的要核准這些動作，請到該 agent 的 UI 以有人值守模式接續（Phase 5 會從這裡直接連過去）。
            或把放行規則加進腦袋 repo 的 <code>.claude/settings.json</code>。下面的「繼續」只會帶著你的回覆重跑這個節點。
          </div>
        </template>
        <textarea v-model="message" class="form-textarea" rows="3" placeholder="給 agent 的回覆（選填）" />
        <div style="margin-top:8px;">
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="resume">{{ waitingGate ? '放行' : '繼續' }}</button>
        </div>
        <div v-if="actionError" class="alert alert-error" style="margin-top:8px;">{{ actionError }}</div>
      </div>

      <div class="run-body">
        <div class="run-graph">
          <WorkflowGraphView v-if="run.graph" :graph="run.graph" :agent-names="agentNames" :node-states="nodeStates" />
        </div>

        <div class="run-steps">
          <div class="panel-title">步驟</div>
          <div v-for="s in run.steps" :key="s.id" class="step-card" :class="{ open: openStep === s.id }">
            <div class="step-row" @click="openStep = openStep === s.id ? null : s.id">
              <span class="seq">#{{ s.seq }}</span>
              <span class="mono">{{ s.node }}</span>
              <span class="kind" :class="s.kind">{{ kindLabel[s.kind] }}{{ s.attempt > 1 ? ` ${s.attempt}` : '' }}</span>
              <RunStatusBadge :status="s.status" />
              <span v-if="s.result?.label" class="label-tag">{{ s.result.label }}</span>
              <span style="flex:1;" />
              <span class="meta">{{ fmtDuration(s.result?.durationMs) }} · {{ fmtCost(s.result?.costUsd) }}</span>
            </div>
            <div v-if="openStep === s.id" class="step-detail">
              <div v-if="s.human" class="block">
                <div class="block-title">人工回覆</div>
                <pre>{{ s.human }}</pre>
              </div>
              <div v-if="s.input" class="block">
                <div class="block-title">輸入</div>
                <pre>{{ s.input }}</pre>
              </div>
              <div v-if="s.result?.summary" class="block">
                <div class="block-title">結果</div>
                <pre>{{ s.result.summary }}</pre>
              </div>
              <div v-if="s.result?.mrUrl" class="block">
                <a :href="s.result.mrUrl" target="_blank" rel="noopener">{{ s.result.mrUrl }}</a>
              </div>
              <div v-if="s.result?.error" class="block">
                <div class="block-title">錯誤</div>
                <pre class="err">{{ s.result.error }}</pre>
              </div>
              <div class="meta">
                {{ fmtTime(s.createdAt) }} 入列 · 開始 {{ fmtTime(s.startedAt) }} · 結束 {{ fmtTime(s.endedAt) }}
                <span v-if="s.agentId"> · {{ agentNames[s.agentId] ?? s.agentId.slice(0, 8) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { runsApi } from '@/api'
import RunStatusBadge from '@/components/RunStatusBadge.vue'
import WorkflowGraphView, { type NodeRunState } from '@/components/WorkflowGraphView.vue'
import { useWorkflowsStore, type RunDetail } from '@/stores/workflows'
import { useAgentsStore } from '@/stores/agents'
import { fmtCost, fmtDuration, fmtTime } from '@/utils/format'

const route = useRoute()
const workflows = useWorkflowsStore()
const agents = useAgentsStore()

const run = ref<RunDetail | null>(null)
const notFound = ref(false)
const message = ref('')
const busy = ref(false)
const actionError = ref('')
const openStep = ref<string | null>(null)

const kindLabel: Record<string, string> = { run: '執行', retry: '重試', resume: '接續', gate: '關卡' }

const agentNames = computed(() => Object.fromEntries(agents.agents.map((a) => [a.id, a.name])))
const workflowName = computed(() => workflows.nameOf(run.value?.workflowId) ?? 'Workflow')
const totalCost = computed(() => run.value?.steps.reduce((sum, s) => sum + (s.result?.costUsd ?? 0), 0) ?? 0)
const lastStep = computed(() => run.value?.steps.at(-1))
const waitingGate = computed(() => run.value?.status === 'interrupted' && lastStep.value?.kind === 'gate')
const blocked = computed(() => (run.value?.status === 'interrupted' ? lastStep.value?.result?.blocked ?? [] : []))

/** Latest step per node → colour on the graph. */
const nodeStates = computed(() => {
  const states: Record<string, NodeRunState> = {}
  for (const s of run.value?.steps ?? []) {
    if (s.status === 'done') states[s.node] = { status: 'done', text: s.result?.label ? `結論：${s.result.label}` : '完成' }
    else if (s.status === 'failed') states[s.node] = { status: 'failed', text: '失敗' }
    else if (s.status === 'interrupted') states[s.node] = { status: 'waiting', text: '等待人工' }
    else if (s.status === 'queued' || s.status === 'running') states[s.node] = { status: 'current', text: s.status === 'queued' ? '排隊中' : '執行中' }
  }
  if (run.value?.status === 'interrupted' && run.value.currentNode)
    states[run.value.currentNode] = { status: 'waiting', text: '等待人工' }
  return states
})

async function load() {
  try {
    const { data } = await runsApi.get(route.params.id as string)
    run.value = data
    notFound.value = false
  } catch (e: unknown) {
    if ((e as { response?: { status?: number } }).response?.status === 404) notFound.value = true
  }
}

async function resume() {
  busy.value = true
  actionError.value = ''
  try {
    await runsApi.resume(run.value!.id, message.value.trim() || undefined)
    message.value = ''
    await load()
  } catch (e: unknown) {
    actionError.value = (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? '操作失敗'
  } finally {
    busy.value = false
  }
}

async function cancel() {
  if (!confirm('確定取消這個 Run？還沒開始的步驟不會執行。')) return
  busy.value = true
  try {
    await runsApi.cancel(run.value!.id)
    await load()
  } finally {
    busy.value = false
  }
}

// Poll while something can still change.
let timer: ReturnType<typeof setInterval> | undefined
watch(
  () => run.value?.status,
  (status) => {
    clearInterval(timer)
    if (status === 'running' || status === 'interrupted') timer = setInterval(load, 5_000)
  },
)
watch(() => route.params.id, () => { run.value = null; load() })
onMounted(() => {
  workflows.fetch()
  agents.fetch()
  load()
})
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.run-page { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; height: 100%; }
.run-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.back { color: var(--text2); font-size: 13px; text-decoration: none; }
.run-title a { font-size: 16px; font-weight: 600; color: var(--text); text-decoration: none; }
.run-sub { font-size: 12px; color: var(--text3); margin-left: 8px; }
.run-alert { margin: 0; }
.human { border-color: rgba(251,191,36,.4); padding: 14px 16px; }
.human .card-title { margin-bottom: 8px; }
.blocked { margin: 6px 0 8px 18px; font-size: 13px; }
.run-body { display: flex; gap: 16px; flex: 1; min-height: 420px; }
.run-graph { flex: 1; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; min-width: 0; }
.run-steps { width: 440px; overflow-y: auto; flex-shrink: 0; }
.panel-title { font-weight: 600; font-size: 13px; margin-bottom: 10px; }
.step-card { border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 8px; background: var(--surface); }
.step-card.open { border-color: var(--border2); }
.step-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; font-size: 13px; }
.seq { color: var(--text3); font-size: 12px; width: 26px; }
.kind { font-size: 11px; color: var(--text2); }
.kind.gate { color: var(--yellow); }
.kind.retry { color: var(--red); }
.kind.resume { color: var(--blue); }
.label-tag { font-size: 10px; padding: 1px 6px; border-radius: 10px; background: var(--blue-bg); color: var(--blue); }
.meta { font-size: 11px; color: var(--text3); }
.step-detail { border-top: 1px solid var(--border); padding: 10px; display: flex; flex-direction: column; gap: 10px; }
.block-title { font-size: 11px; color: var(--text3); margin-bottom: 4px; }
pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: var(--bg); padding: 8px; border-radius: 6px; max-height: 280px; overflow-y: auto; }
pre.err { color: var(--red); }
.mono { font-family: ui-monospace, monospace; }
</style>
