import { defineStore } from 'pinia'
import { agentsApi } from '@/api'

export interface Agent {
  id: string
  name: string
  description?: string
  instruction?: string
  queueId?: string
  queueName?: string
  apiToken: string
  // 'running' 由 agent 自己回報的心跳更新（/internal/agent-heartbeat），非平台驅動
  status: 'stopped' | 'running' | 'error'
  createdAt: number
  updatedAt: number
}

export const useAgentsStore = defineStore('agents', {
  state: () => ({ agents: [] as Agent[], loading: false }),
  actions: {
    async fetch() {
      this.loading = true
      try {
        const { data } = await agentsApi.list()
        this.agents = data
      } finally {
        this.loading = false
      }
    },
    async create(payload: Record<string, unknown>) {
      const { data } = await agentsApi.create(payload)
      this.agents.unshift(data)
      return data
    },
    async update(id: string, payload: Record<string, unknown>) {
      const { data } = await agentsApi.update(id, payload)
      const idx = this.agents.findIndex((a) => a.id === id)
      if (idx !== -1) this.agents[idx] = { ...this.agents[idx], ...data }
    },
    async delete(id: string) {
      await agentsApi.delete(id)
      this.agents = this.agents.filter((a) => a.id !== id)
    },
  },
})
