<template>
  <div class="auth-wrap">
    <div class="auth-box">
      <div class="auth-logo">
        <div class="logo-icon">A</div>
        <div class="auth-title">Agent Manager</div>
      </div>
      <h2 class="auth-heading">建立帳號</h2>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input v-model="email" class="form-input" type="email" placeholder="you@example.com" />
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input v-model="password" class="form-input" type="password" placeholder="••••••••" @keydown.enter="submit" />
      </div>
      <button class="btn btn-primary" style="width:100%;" :disabled="loading" @click="submit">
        {{ loading ? '建立中...' : '建立帳號' }}
      </button>
      <p class="auth-footer">
        已有帳號？<span class="auth-link" @click="router.push('/login')">登入</span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  if (!email.value || !password.value) return
  loading.value = true
  error.value = ''
  try {
    await auth.register(email.value, password.value)
    router.push('/agents')
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    error.value = msg ?? '註冊失敗'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-wrap {
  min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg);
}
.auth-box {
  width: 380px; background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 32px;
}
.auth-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
.logo-icon {
  width: 32px; height: 32px; background: var(--accent); border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700; color: #0d0d0d;
}
.auth-title { font-size: 16px; font-weight: 700; }
.auth-heading { font-size: 20px; font-weight: 700; margin-bottom: 20px; }
.auth-footer { margin-top: 16px; font-size: 13px; color: var(--text2); text-align: center; }
.auth-link { color: var(--accent); cursor: pointer; }
.auth-link:hover { text-decoration: underline; }
</style>
