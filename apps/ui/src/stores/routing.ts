import { defineStore } from 'pinia'
import { routingApi } from '@/api'

export interface RoutingRule {
  id: string
  name?: string
  brokerId: string
  brokerName?: string
  brokerType?: string
  queueId: string
  queueName?: string
  eventTypes?: string   // JSON string[]
  replyTarget?: string
  createdAt: number
}

export const useRoutingStore = defineStore('routing', {
  state: () => ({ rules: [] as RoutingRule[], loading: false }),
  actions: {
    async fetch() {
      this.loading = true
      try {
        const { data } = await routingApi.list()
        this.rules = data
      } finally {
        this.loading = false
      }
    },
    async create(payload: Record<string, unknown>) {
      const { data } = await routingApi.create(payload)
      this.rules.unshift(data)
      return data
    },
    async delete(id: string) {
      await routingApi.delete(id)
      this.rules = this.rules.filter((r) => r.id !== id)
    },
    eventTypesList(rule: RoutingRule): string[] {
      if (!rule.eventTypes) return []
      try { return JSON.parse(rule.eventTypes) } catch { return [] }
    },
  },
})
