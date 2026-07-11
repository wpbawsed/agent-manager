import { defineStore } from 'pinia'
import { routingApi } from '@/api'

export interface RoutingCondition {
  field: string
  op: 'eq' | 'neq' | 'in' | 'nin' | 'contains' | 'startsWith'
  value: string | string[]
}

// 一個 reply 動作：可回覆訊息、可轉 Jira 狀態，兩者可並存。全部留空 = 不做事。
export interface ReplyStep {
  reply?: boolean
  jiraTransition?: string
  prefix?: string
}

// 收到事件 / agent 成功 / agent 失敗，各自可設一個 ReplyStep。未設的階段 = 不自動回覆。
export interface ReplyPolicy {
  onReceived?: ReplyStep
  onSuccess?: ReplyStep
  onFailure?: ReplyStep
}

export interface RoutingRule {
  id: string
  name?: string
  brokerId: string
  brokerName?: string
  brokerType?: string
  queueId: string
  queueName?: string
  eventTypes?: string   // JSON string[]
  conditions?: string   // JSON RoutingCondition[]
  replyTarget?: string
  replyPolicy?: string  // JSON ReplyPolicy
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
    async update(id: string, payload: Record<string, unknown>) {
      const { data } = await routingApi.update(id, payload)
      const idx = this.rules.findIndex((r) => r.id === id)
      if (idx !== -1) this.rules[idx] = { ...this.rules[idx], ...data }
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
    conditionsList(rule: RoutingRule): RoutingCondition[] {
      if (!rule.conditions) return []
      try { return JSON.parse(rule.conditions) } catch { return [] }
    },
    replyPolicyObj(rule: RoutingRule): ReplyPolicy | null {
      if (!rule.replyPolicy) return null
      try { return JSON.parse(rule.replyPolicy) } catch { return null }
    },
  },
})
