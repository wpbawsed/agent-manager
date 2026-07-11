import { defineStore } from 'pinia'
import { agentsApi } from '@/api'

export interface AgentIntegration {
  agentId: string
  apiToken: string
  managerUrl: string
  endpoints: { heartbeat: string; metrics: string; logs: string }
  snippet: string
  files: Record<string, string>
}

export interface Agent {
  id: string
  name: string
  description?: string
  instruction?: string
  queueId?: string
  queueName?: string
  runtimeCmd?: string
  type: 'local' | 'cloud'
  endpoint?: string
  apiToken: string
  status: 'stopped' | 'running' | 'error'
  online: boolean
  lastHeartbeatAt?: number
  createdAt: number
  updatedAt: number
}

export type CreatedAgent = Agent & {
  integration: AgentIntegration | null
  deploy: { ok: boolean; error?: string } | null
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
    async create(payload: Record<string, unknown>): Promise<CreatedAgent> {
      const { data } = await agentsApi.create(payload)
      const { integration, deploy, ...agent } = data as CreatedAgent
      this.agents.unshift(agent as Agent)
      return data
    },
    async integration(id: string): Promise<AgentIntegration> {
      const { data } = await agentsApi.integration(id)
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
