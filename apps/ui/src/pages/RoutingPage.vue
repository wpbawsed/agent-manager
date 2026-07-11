<template>
  <div style="padding:24px;">
    <div class="alert alert-info" style="margin-bottom:20px;">
      ⟳ <strong>replyTarget</strong> — 設定後，agent 會回覆到指定 URI，而非事件的原始來源。
      例如：Railway 部署事件 → 通知到 <code>slack://C1234567</code>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Routing Rules</div>
          <div class="card-sub">eventTypes 為空 = catch-all；符合則派送至指定 Queue</div>
        </div>
        <button class="btn btn-primary btn-sm" @click="openCreate">+ Add Rule</button>
      </div>
      <div v-if="routing.loading" class="empty">載入中...</div>
      <div v-else-if="!routing.rules.length" class="empty">尚無 Routing Rule</div>
      <table v-else>
        <thead>
          <tr>
            <th>Broker</th>
            <th>Queue</th>
            <th>Event Types</th>
            <th>Conditions</th>
            <th>Reply Target</th>
            <th>Reply Policy</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in routing.rules" :key="r.id">
            <td>
              <div style="font-weight:500;">{{ r.brokerName ?? r.brokerId }}</div>
              <span v-if="r.brokerType" class="chip" :class="r.brokerType" style="margin-top:4px;">{{ r.brokerType }}</span>
            </td>
            <td>
              <span v-if="r.queueName" class="queue-tag">{{ r.queueName }}</span>
              <span v-else style="color:var(--text3);">{{ r.queueId }}</span>
            </td>
            <td>
              <template v-if="routing.eventTypesList(r).length">
                <span v-for="et in routing.eventTypesList(r)" :key="et" class="event-tag">{{ et }}</span>
              </template>
              <span v-else class="catchall" style="color:var(--text3); font-style:italic; font-size:12px;">catch-all</span>
            </td>
            <td>
              <template v-if="routing.conditionsList(r).length">
                <div v-for="(c, i) in routing.conditionsList(r)" :key="i" style="font-size:11px; font-family:monospace; color:var(--blue);">
                  {{ c.field }} {{ c.op }} {{ Array.isArray(c.value) ? c.value.join('|') : c.value }}
                </div>
              </template>
              <span v-else style="color:var(--text3); font-size:12px; font-style:italic;">—</span>
            </td>
            <td>
              <span v-if="r.replyTarget" class="mono" style="font-size:12px; color:var(--blue);">{{ r.replyTarget }}</span>
              <span v-else style="color:var(--text3); font-size:12px; font-style:italic;">原路回覆</span>
            </td>
            <td>
              <div v-if="policySummary(r).length" style="display:flex; flex-direction:column; gap:2px;">
                <span v-for="(line, i) in policySummary(r)" :key="i" style="font-size:11px; color:var(--text2);">{{ line }}</span>
              </div>
              <span v-else style="color:var(--text3); font-size:12px; font-style:italic;">未設定</span>
            </td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm" style="margin-right:4px;" @click="openEdit(r)">Edit</button>
              <button class="btn btn-danger btn-sm" @click="deleteRule(r.id)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Add Rule Modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Add Routing Rule</div>
          <button class="modal-close" @click="showCreate = false">✕</button>
        </div>
        <div class="modal-body">
          <div v-if="createError" class="alert alert-error">{{ createError }}</div>
          <div class="form-group">
            <label class="form-label">Name (optional)</label>
            <input v-model="form.name" class="form-input" placeholder="Jira → jira-queue" />
          </div>
          <div class="form-group">
            <label class="form-label">Broker *</label>
            <select v-model="form.brokerId" class="form-select">
              <option value="">— Select broker —</option>
              <option v-for="b in brokers.brokers" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Queue *</label>
            <select v-model="form.queueId" class="form-select">
              <option value="">— Select queue —</option>
              <option v-for="q in queues.queues" :key="q.id" :value="q.id">{{ q.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Event Types (optional, 空白 = catch-all)</label>
            <input v-model="form.eventTypes" class="form-input" placeholder="jira:issue_created, jira:issue_updated" />
            <div class="form-hint">逗號分隔。符合 agentEvent.eventType 才派送</div>
          </div>
          <div class="form-group">
            <label class="form-label">Reply Target (optional)</label>
            <input v-model="form.replyTarget" class="form-input" placeholder="slack://C0987654321" />
            <div class="form-hint">留空則回覆到事件的原始來源。格式：slack:// jira:// notion:// webhook://</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="showCreate = false">Cancel</button>
          <button class="btn btn-primary" :disabled="creating" @click="createRule">
            {{ creating ? '建立中...' : 'Add Rule' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Edit Rule Modal -->
    <div v-if="showEdit" class="modal-overlay" @click.self="showEdit = false">
      <div class="modal" style="max-width:560px;">
        <div class="modal-header">
          <div class="modal-title">Edit Routing Rule</div>
          <button class="modal-close" @click="showEdit = false">✕</button>
        </div>
        <div class="modal-body">
          <div v-if="editError" class="alert alert-error">{{ editError }}</div>
          <div class="form-group">
            <label class="form-label">Name</label>
            <input v-model="editForm.name" class="form-input" placeholder="My rule" />
          </div>
          <div class="form-group">
            <label class="form-label">Event Types (逗號分隔，空白 = catch-all)</label>
            <input v-model="editForm.eventTypes" class="form-input" placeholder="jira:issue_created, jira:issue_updated" />
          </div>
          <div class="form-group">
            <label class="form-label">Conditions (payload 層級過濾)</label>
            <div style="font-size:12px; color:var(--text3); margin-bottom:6px;">
              每行一個條件，格式：<code>field op value</code><br/>
              field: projectKey / status / assignee / issueKey / summary / eventType<br/>
              op: eq / neq / in / nin / contains / startsWith<br/>
              value: 單值 或 逗號分隔多值（in/nin 用）
            </div>
            <textarea
              v-model="editForm.conditionsText"
              class="form-input"
              rows="4"
              placeholder="projectKey eq B2B&#10;status in Ready to go,To Do&#10;assignee eq user@example.com"
              style="font-family:monospace; font-size:12px;"
            />
          </div>
          <div class="form-group">
            <label class="form-label">Reply Target</label>
            <input v-model="editForm.replyTarget" class="form-input" placeholder="slack://C0987654321（空白 = 原路回覆）" />
          </div>

          <div class="form-group">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <label class="form-label" style="margin-bottom:0;">Reply Policy — Agent 完成任務後自動回覆</label>
              <button class="btn btn-ghost btn-sm" type="button" @click="applyExamplePolicy">套用範例（Jira 開發流程）</button>
            </div>
            <div class="form-hint" style="margin-bottom:8px;">
              收到事件 / Agent 成功 / Agent 失敗，各自可設「回覆訊息」與「轉 Jira 狀態為」。全部留空 = 不自動回覆，維持手動。
            </div>

            <div
              v-for="stage in policyStages"
              :key="stage.key"
              style="border:1px solid var(--border2); border-radius:8px; padding:10px 12px; margin-bottom:8px;"
            >
              <div style="font-size:12px; font-weight:600; color:var(--text2); margin-bottom:6px;">{{ stage.label }}</div>
              <label style="display:flex; align-items:center; gap:6px; font-size:13px; margin-bottom:6px; cursor:pointer;">
                <input type="checkbox" v-model="editForm.policy[stage.key].reply" />
                回覆訊息（貼回 Slack / Jira 留言）
              </label>
              <input
                v-if="editForm.policy[stage.key].reply"
                v-model="editForm.policy[stage.key].prefix"
                class="form-input"
                style="margin-bottom:6px;"
                :placeholder="stage.prefixPlaceholder"
              />
              <input
                v-model="editForm.policy[stage.key].jiraTransition"
                class="form-input"
                :placeholder="`轉 Jira 狀態為（留空 = 不轉），例如：${stage.transitionPlaceholder}`"
              />
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="showEdit = false">Cancel</button>
          <button class="btn btn-primary" :disabled="saving" @click="saveEdit">
            {{ saving ? '儲存中...' : 'Save' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoutingStore } from '@/stores/routing'
import type { RoutingRule, RoutingCondition, ReplyPolicy, ReplyStep } from '@/stores/routing'
import { useBrokersStore } from '@/stores/brokers'
import { useQueuesStore } from '@/stores/queues'

const routing = useRoutingStore()
const brokers = useBrokersStore()
const queues  = useQueuesStore()

// ── Reply Policy（UI 設定，實際存 JSON）──────────────────────────────
type PolicyStageKey = 'onReceived' | 'onSuccess' | 'onFailure'
type PolicyForm = Record<PolicyStageKey, { reply: boolean; jiraTransition: string; prefix: string }>

function emptyPolicyForm(): PolicyForm {
  return {
    onReceived: { reply: false, jiraTransition: '', prefix: '' },
    onSuccess:  { reply: false, jiraTransition: '', prefix: '' },
    onFailure:  { reply: false, jiraTransition: '', prefix: '' },
  }
}

const policyStages: Array<{ key: PolicyStageKey; label: string; prefixPlaceholder: string; transitionPlaceholder: string }> = [
  { key: 'onReceived', label: '收到事件（Ack）', prefixPlaceholder: '回覆的訊息內容（此階段還沒有 agent 結果，此欄即完整文字）', transitionPlaceholder: '進行中' },
  { key: 'onSuccess',  label: 'Agent 完成',      prefixPlaceholder: '訊息前綴，例如：✅ ',                   transitionPlaceholder: 'Wait UAT' },
  { key: 'onFailure',  label: 'Agent 失敗',      prefixPlaceholder: '訊息前綴，例如：❌ ',                   transitionPlaceholder: '（通常留空，人工確認）' },
]

/** PolicyForm → ReplyPolicy（去掉三個階段都空的欄位）；全空回傳 null。 */
function policyFormToPayload(form: PolicyForm): ReplyPolicy | null {
  const policy: ReplyPolicy = {}
  for (const stage of policyStages) {
    const f = form[stage.key]
    const step: ReplyStep = {}
    if (f.reply) step.reply = true
    if (f.jiraTransition.trim()) step.jiraTransition = f.jiraTransition.trim()
    if (f.prefix.trim()) step.prefix = f.prefix.trim()
    if (Object.keys(step).length) policy[stage.key] = step
  }
  return Object.keys(policy).length ? policy : null
}

/** ReplyPolicy(JSON) → PolicyForm，供 Edit modal 顯示既有設定。 */
function policyToForm(policy: ReplyPolicy | null): PolicyForm {
  const form = emptyPolicyForm()
  if (!policy) return form
  for (const stage of policyStages) {
    const step = policy[stage.key]
    if (step) {
      form[stage.key] = {
        reply: !!step.reply,
        jiraTransition: step.jiraTransition ?? '',
        prefix: step.prefix ?? '',
      }
    }
  }
  return form
}

/** 表格摘要：把 policy 濃縮成一行行人看得懂的文字 */
function policySummary(rule: RoutingRule): string[] {
  const policy = routing.replyPolicyObj(rule)
  if (!policy) return []
  const labelOf: Record<PolicyStageKey, string> = { onReceived: '收到', onSuccess: '成功', onFailure: '失敗' }
  const lines: string[] = []
  for (const key of ['onReceived', 'onSuccess', 'onFailure'] as PolicyStageKey[]) {
    const step = policy[key]
    if (!step) continue
    const parts: string[] = []
    if (step.reply) parts.push('回覆')
    if (step.jiraTransition) parts.push(`轉「${step.jiraTransition}」`)
    if (parts.length) lines.push(`${labelOf[key]}：${parts.join(' + ')}`)
  }
  return lines
}

// b2b-crm 舊 adapter 的實際行為，改寫成宣告式 policy 範例
function applyExamplePolicy() {
  editForm.value.policy = {
    onReceived: { reply: false, jiraTransition: '進行中', prefix: '' },
    onSuccess:  { reply: true, jiraTransition: 'Wait UAT', prefix: '' },
    onFailure:  { reply: true, jiraTransition: '', prefix: '❌ ' },
  }
}

// ── Create ────────────────────────────────────────────────────────────
const showCreate  = ref(false)
const creating    = ref(false)
const createError = ref('')
const form = ref({ name: '', brokerId: '', queueId: '', eventTypes: '', replyTarget: '' })

function openCreate() {
  form.value = { name: '', brokerId: '', queueId: '', eventTypes: '', replyTarget: '' }
  createError.value = ''
  showCreate.value = true
}

async function createRule() {
  if (!form.value.brokerId || !form.value.queueId) return
  creating.value = true
  createError.value = ''
  try {
    const eventTypes = form.value.eventTypes
      ? form.value.eventTypes.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined
    await routing.create({
      name: form.value.name || undefined,
      brokerId: form.value.brokerId,
      queueId: form.value.queueId,
      eventTypes,
      replyTarget: form.value.replyTarget || undefined,
    })
    showCreate.value = false
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    createError.value = msg ?? '建立失敗'
  } finally {
    creating.value = false
  }
}

// ── Edit ──────────────────────────────────────────────────────────────
const showEdit   = ref(false)
const saving     = ref(false)
const editError  = ref('')
const editId     = ref('')
const editForm   = ref({ name: '', eventTypes: '', conditionsText: '', replyTarget: '', policy: emptyPolicyForm() })

function openEdit(rule: RoutingRule) {
  editId.value = rule.id
  editForm.value = {
    name:           rule.name ?? '',
    eventTypes:     routing.eventTypesList(rule).join(', '),
    conditionsText: routing.conditionsList(rule)
      .map((c) => `${c.field} ${c.op} ${Array.isArray(c.value) ? c.value.join(',') : c.value}`)
      .join('\n'),
    replyTarget: rule.replyTarget ?? '',
    policy: policyToForm(routing.replyPolicyObj(rule)),
  }
  editError.value = ''
  showEdit.value = true
}

function parseConditionsText(text: string): RoutingCondition[] {
  return text.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/)
      if (parts.length < 3) return null
      const [field, op, ...rest] = parts
      const rawValue = rest.join(' ')
      const value = ['in', 'nin'].includes(op)
        ? rawValue.split(',').map((v) => v.trim()).filter(Boolean)
        : rawValue
      return { field, op, value } as RoutingCondition
    })
    .filter((c): c is RoutingCondition => c !== null)
}

async function saveEdit() {
  saving.value = true
  editError.value = ''
  try {
    const eventTypes = editForm.value.eventTypes
      ? editForm.value.eventTypes.split(',').map((s) => s.trim()).filter(Boolean)
      : null
    const conditions = editForm.value.conditionsText.trim()
      ? parseConditionsText(editForm.value.conditionsText)
      : null
    await routing.update(editId.value, {
      name:        editForm.value.name || null,
      eventTypes,
      conditions,
      replyTarget: editForm.value.replyTarget || null,
      replyPolicy: policyFormToPayload(editForm.value.policy),
    })
    showEdit.value = false
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    editError.value = msg ?? '儲存失敗'
  } finally {
    saving.value = false
  }
}

// ── Delete ────────────────────────────────────────────────────────────
async function deleteRule(id: string) {
  if (!confirm('確定要刪除此 Routing Rule？')) return
  await routing.delete(id)
}

onMounted(() => {
  routing.fetch()
  brokers.fetch()
  queues.fetch()
})
</script>
