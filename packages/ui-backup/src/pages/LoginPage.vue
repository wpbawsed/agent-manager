<template>
  <div class="auth-page">
    <n-card title="登入 Agent Manager" style="max-width: 400px; margin: 0 auto;">
      <n-form @submit.prevent="handleLogin">
        <n-form-item label="Email">
          <n-input v-model:value="email" type="text" placeholder="your@email.com" />
        </n-form-item>
        <n-form-item label="密碼">
          <n-input v-model:value="password" type="password" placeholder="請輸入密碼" />
        </n-form-item>
        <n-alert v-if="errorMsg" type="error" :title="errorMsg" style="margin-bottom: 12px;" />
        <n-button type="primary" attr-type="submit" block :loading="auth.loading">
          登入
        </n-button>
        <div style="margin-top: 12px; text-align: center;">
          <router-link to="/register">還沒有帳號？立即註冊</router-link>
        </div>
      </n-form>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { NCard, NForm, NFormItem, NInput, NButton, NAlert } from 'naive-ui'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const email = ref('')
const password = ref('')
const errorMsg = ref('')

async function handleLogin() {
  errorMsg.value = ''
  try {
    await auth.doLogin(email.value, password.value)
    router.push('/agents')
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.error ?? '登入失敗，請確認帳號密碼'
  }
}
</script>

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  padding: 24px;
}
</style>
