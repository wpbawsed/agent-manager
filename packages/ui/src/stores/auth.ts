import { defineStore } from 'pinia'
import { authApi } from '@/api'

interface User {
  id: string
  email: string
  role: string
  subdomain?: string
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    token: localStorage.getItem('token') ?? null,
  }),
  getters: {
    isLoggedIn: (state) => !!state.token,
  },
  actions: {
    async login(email: string, password: string) {
      const { data } = await authApi.login(email, password)
      this.token = data.token
      localStorage.setItem('token', data.token)
      await this.fetchMe()
    },
    async register(email: string, password: string) {
      const { data } = await authApi.register(email, password)
      this.token = data.token
      localStorage.setItem('token', data.token)
      await this.fetchMe()
    },
    async fetchMe() {
      try {
        const { data } = await authApi.me()
        this.user = data
      } catch {
        this.logout()
      }
    },
    logout() {
      this.user = null
      this.token = null
      localStorage.removeItem('token')
    },
  },
})
