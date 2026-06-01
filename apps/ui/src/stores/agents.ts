import { defineStore } from 'pinia'
import { agentsApi } from '@/api'

export interface Agent {
  id: string
  name: string
  description?: string
  instruction?: string
  queueId?: string
  queueName?: string
  runtimeCmd?: string
  apiToken: string
  status: 'stopped' | 'running' | 'error'
  createdAt: number
  updatedAt: number
  liveStatus?: { running: boolean; pid?: number; uptime?: number }
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
    async start(id: string) {
      await agentsApi.start(id)
      const a = this.agents.find((a) => a.id === id)
      if (a) a.status = 'running'
    },
    async stop(id: string) {
      await agentsApi.stop(id)
      const a = this.agents.find((a) => a.id === id)
      if (a) a.status = 'stopped'
    },
  },
})
