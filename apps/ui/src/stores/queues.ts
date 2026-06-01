import { defineStore } from 'pinia'
import { queuesApi } from '@/api'

export interface Queue {
  id: string
  name: string
  description?: string
  ownerId: string
  createdAt: number
}

export const useQueuesStore = defineStore('queues', {
  state: () => ({ queues: [] as Queue[], loading: false }),
  actions: {
    async fetch() {
      this.loading = true
      try {
        const { data } = await queuesApi.list()
        this.queues = data
      } finally {
        this.loading = false
      }
    },
    async create(payload: { name: string; description?: string }) {
      const { data } = await queuesApi.create(payload)
      this.queues.unshift(data)
      return data
    },
    async delete(id: string) {
      await queuesApi.delete(id)
      this.queues = this.queues.filter((q) => q.id !== id)
    },
  },
})
