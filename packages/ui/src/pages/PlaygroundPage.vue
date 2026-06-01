<template>
  <div style="display: flex; height: calc(100vh - 96px); gap: 16px;">
    <!-- Left: Chat -->
    <div style="flex: 1; display: flex; flex-direction: column; border: 1px solid #333; border-radius: 8px; overflow: hidden;">
      <!-- Agent Info Header -->
      <div style="padding: 12px 16px; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 12px;">
        <n-tag v-if="agent?.status" :type="agent.status === 'running' ? 'success' : 'default'" size="small">{{ agent.status }}</n-tag>
        <span style="font-weight: 600;">{{ agent?.name ?? '...' }}</span>
        <n-button size="tiny" text @click="clearHistory">清除對話</n-button>
      </div>

      <!-- Messages -->
      <div ref="messagesRef" style="flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px;">
        <div v-if="messages.length === 0" style="color: #555; font-size: 13px; text-align: center; margin-top: 60px;">
          開始和 Agent 對話...
        </div>
        <div
          v-for="(msg, i) in messages"
          :key="i"
          :style="{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }"
        >
          <div
            :style="{
              maxWidth: '75%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              background: msg.role === 'user' ? '#1e3a5f' : '#1a1a2e',
              color: msg.role === 'user' ? '#bfdbfe' : '#e5e7eb',
              fontSize: '13px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
            }"
          >
            {{ msg.content }}
            <span v-if="i === messages.length - 1 && streaming" style="display: inline-block; width: 6px; height: 12px; background: #7c3aed; margin-left: 2px; animation: blink 1s infinite;" />
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <div style="padding: 12px; border-top: 1px solid #333; display: flex; gap: 8px;">
        <n-input
          v-model:value="inputText"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 4 }"
          placeholder="輸入訊息... (Shift+Enter 換行)"
          :disabled="streaming"
          @keydown.enter.exact.prevent="sendMessage"
        />
        <n-button
          type="primary"
          :loading="streaming"
          :disabled="!inputText.trim()"
          style="align-self: flex-end;"
          @click="sendMessage"
        >
          送出
        </n-button>
      </div>
    </div>

    <!-- Right: Instruction Panel -->
    <div style="width: 280px; display: flex; flex-direction: column; gap: 12px;">
      <n-card title="System Prompt" size="small" style="flex: 1;">
        <div style="font-size: 12px; color: #aaa; white-space: pre-wrap; overflow-y: auto; max-height: 400px;">
          {{ agent?.instruction || '（未設定 System Prompt）' }}
        </div>
      </n-card>
      <n-card title="對話紀錄" size="small">
        <div style="font-size: 12px; color: #888;">
          {{ historyForApi.length / 2 }} 輪對話
        </div>
        <n-button size="tiny" block style="margin-top: 8px;" @click="clearHistory">清除</n-button>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { NInput, NButton, NTag, NCard } from 'naive-ui'
import { useAgentsStore } from '@/stores/agents'
import { runPlayground, type PlaygroundMessage } from '@/api/playground'

const route = useRoute()
const agentsStore = useAgentsStore()

const agentId = computed(() => route.params.id as string)
const agent = computed(() => agentsStore.agents.find(a => a.id === agentId.value) ?? null)

onMounted(async () => {
  if (!agentsStore.agents.length) {
    await agentsStore.fetchAgents()
  }
})

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const messages = ref<Message[]>([])
const inputText = ref('')
const streaming = ref(false)
const messagesRef = ref<HTMLElement | null>(null)

const historyForApi = computed((): PlaygroundMessage[] =>
  messages.value.map(m => ({ role: m.role, content: m.content }))
)

function clearHistory() {
  messages.value = []
}

async function scrollToBottom() {
  await nextTick()
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  }
}

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || streaming.value) return

  inputText.value = ''
  messages.value.push({ role: 'user', content: text })
  await scrollToBottom()

  // Add empty assistant message to fill in streaming
  const assistantIdx = messages.value.length
  messages.value.push({ role: 'assistant', content: '' })
  streaming.value = true

  try {
    const history = historyForApi.value.slice(0, -1) // exclude the empty assistant msg
    for await (const chunk of runPlayground(agentId.value, text, history.slice(0, -1))) {
      messages.value[assistantIdx].content += chunk
      await scrollToBottom()
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    messages.value[assistantIdx].content = `[錯誤] ${errorMessage}`
  } finally {
    streaming.value = false
  }
}
</script>

<style scoped>
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
</style>
