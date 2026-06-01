import { defineStore } from 'pinia'
import { brokersApi } from '@/api'

export interface Broker {
  id: string
  name: string
  type: string
  config: string
  webhookPath: string
  requiredVars?: string
  status: 'active' | 'inactive' | 'error'
  createdAt: number
  updatedAt: number
}

export const useBrokersStore = defineStore('brokers', {
  state: () => ({ brokers: [] as Broker[], loading: false }),
  actions: {
    async fetch() {
      this.loading = true
      try {
        const { data } = await brokersApi.list()
        this.brokers = data
      } finally {
        this.loading = false
      }
    },
    async create(payload: Record<string, unknown>) {
      const { data } = await brokersApi.create(payload)
      this.brokers.unshift(data)
      return data
    },
    async update(id: string, payload: Record<string, unknown>) {
      const { data } = await brokersApi.update(id, payload)
      const idx = this.brokers.findIndex((b) => b.id === id)
      if (idx !== -1) this.brokers[idx] = { ...this.brokers[idx], ...data }
    },
    async delete(id: string) {
      await brokersApi.delete(id)
      this.brokers = this.brokers.filter((b) => b.id !== id)
    },
    async activate(id: string) {
      await brokersApi.activate(id)
      const b = this.brokers.find((b) => b.id === id)
      if (b) b.status = 'active'
    },
    async deactivate(id: string) {
      await brokersApi.deactivate(id)
      const b = this.brokers.find((b) => b.id === id)
      if (b) b.status = 'inactive'
    },
  },
})
