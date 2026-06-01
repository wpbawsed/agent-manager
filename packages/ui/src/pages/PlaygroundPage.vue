<template>
  <div style="padding:24px; max-width:800px;">
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header">
        <div class="card-title">Playground</div>
        <div class="card-sub">直接傳送訊息給 Agent，測試輸入/輸出，不走 Webhook 流程</div>
      </div>
      <div style="padding:16px;">
        <div class="form-group">
          <label class="form-label">Target Agent</label>
          <select v-model="selectedAgent" class="form-select">
            <option value="">— Select agent —</option>
            <option v-for="a in agents.agents" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Chat -->
    <div class="card">
      <div ref="logEl" class="chat-log" style="height:400px; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:8px;">
        <div v-if="!messages.length" class="empty" style="height:100%; display:flex; align-items:center; justify-content:center;">
          選擇 Agent 並開始傳訊息
        </div>
        <div v-for="(m, i) in messages" :key="i" class="chat-msg" :class="m.role">
          <div class="chat-bubble">
            <span v-if="m.role === 'assistant'" class="msg-prefix">🤖 Agent</span>
            <span v-else class="msg-prefix">👤 You</span>
            <pre class="msg-text">{{ m.content }}</pre>
          </div>
        </div>
        <div v-if="streaming" class="chat-msg assistant">
          <div class="chat-bubble">
            <span class="msg-prefix">🤖 Agent</span>
            <pre class="msg-text">{{ streamBuf }}<span class="cursor">▌</span></pre>
          </div>
        </div>
      </div>
      <div class="chat-input-row" style="padding:12px 16px; border-top:1px solid var(--border); display:flex; gap:8px;">
        <textarea
          v-model="inputText"
          class="form-input"
          rows="2"
          placeholder="Type your message..."
          style="flex:1; resize:none;"
          @keydown.enter.exact.prevent="send"
        />
        <button class="btn btn-primary" style="align-self:flex-end;" :disabled="!selectedAgent || !inputText.trim() || streaming" @click="send">
          {{ streaming ? '...' : 'Send' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import { useAgentsStore } from '@/stores/agents'
import { playgroundStream } from '@/api'

const agents = useAgentsStore()

const selectedAgent = ref('')
const inputText = ref('')
const messages = ref<{ role: 'user' | 'assistant'; content: string }[]>([])
const streaming = ref(false)
const streamBuf = ref('')
const logEl = ref<HTMLElement | null>(null)

async function scrollBottom() {
  await nextTick()
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
}

async function send() {
  const text = inputText.value.trim()
  if (!text || !selectedAgent.value || streaming.value) return
  messages.value.push({ role: 'user', content: text })
  inputText.value = ''
  await scrollBottom()

  streaming.value = true
  streamBuf.value = ''
  let fullResponse = ''

  try {
    const response = await playgroundStream(selectedAgent.value, text)
    if (!response.body) throw new Error('No response body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      // Handle SSE format: "data: {...}\n\n"
      const lines = chunk.split('\n').filter((l) => l.startsWith('data: '))
      for (const line of lines) {
        const jsonStr = line.slice(6).trim()
        if (jsonStr === '[DONE]') continue
        try {
          const d = JSON.parse(jsonStr)
          const content = d.content ?? d.text ?? d.delta ?? ''
          streamBuf.value += content
          fullResponse += content
          await scrollBottom()
        } catch {
          // raw text chunk
          streamBuf.value += jsonStr
          fullResponse += jsonStr
        }
      }
    }

    messages.value.push({ role: 'assistant', content: fullResponse || streamBuf.value })
    streamBuf.value = ''
    streaming.value = false
    scrollBottom()
  } catch (err) {
    messages.value.push({ role: 'assistant', content: '❌ 連線失敗' })
    streaming.value = false
  }
}

onMounted(() => agents.fetch())
</script>

<style scoped>
.chat-msg { display:flex; flex-direction:column; }
.chat-msg.user { align-items:flex-end; }
.chat-msg.assistant { align-items:flex-start; }
.chat-bubble { max-width:90%; }
.msg-prefix { font-size:11px; color:var(--text3); display:block; margin-bottom:4px; }
.chat-msg.user .msg-prefix { text-align:right; }
.msg-text {
  margin:0;
  background:var(--surface2);
  border:1px solid var(--border);
  border-radius:8px;
  padding:10px 14px;
  font-size:13px;
  font-family:inherit;
  color:var(--text);
  white-space:pre-wrap;
  word-break:break-word;
}
.chat-msg.user .msg-text {
  background:rgba(110, 231, 183, 0.08);
  border-color:rgba(110, 231, 183, 0.3);
}
.cursor { animation: blink 1s infinite; }
@keyframes blink { 0%, 100% { opacity:1 } 50% { opacity:0 } }
</style>
