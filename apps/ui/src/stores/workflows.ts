import { defineStore } from 'pinia'
import { workflowsApi } from '@/api'

// Mirrors apps/api/src/workflow/graph.ts
export const END = 'END'

export interface WorkflowNode {
  id: string
  agentId: string
  input: string
  labels?: string[]
  interruptBefore?: boolean
  position?: { x: number; y: number }
}

export interface EdgeWhen {
  status?: 'done' | 'failed'
  hasMrUrl?: boolean
  label?: string
}

export interface WorkflowEdge {
  from: string
  to: string
  when?: EdgeWhen
}

export interface WorkflowGraph {
  entry: string
  maxSteps?: number
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface WorkflowSummary {
  id: string
  name: string
  description?: string | null
  version: number | null
  updatedAt: number
}

export interface WorkflowDetail extends WorkflowSummary {
  graph: WorkflowGraph | null
  versions: { id: string; version: number; createdAt: number }[]
}

export interface StepResult {
  node: string
  status: 'done' | 'failed'
  summary?: string
  mrUrl?: string
  label?: string
  error?: string
  costUsd?: number
  durationMs?: number
  numTurns?: number
  blocked?: { tool: string; summary: string }[]
  unavailable?: boolean
}

export type RunStatus = 'running' | 'interrupted' | 'done' | 'failed' | 'cancelled'

export interface RunSummary {
  id: string
  workflowId: string
  workflowName: string
  version: number | null
  status: RunStatus
  currentNode: string | null
  steps: number
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface RunStep {
  id: string
  seq: number
  node: string
  agentId: string | null
  eventId: string
  kind: 'run' | 'retry' | 'resume' | 'gate'
  attempt: number
  status: 'queued' | 'running' | 'done' | 'failed' | 'interrupted' | 'cancelled'
  input: string | null
  human: string | null
  result: StepResult | null
  startedAt: number | null
  endedAt: number | null
  createdAt: number
}

export interface RunDetail {
  id: string
  workflowId: string
  status: RunStatus
  currentNode: string | null
  stepCount: number
  error: string | null
  version: number | null
  graph: WorkflowGraph | null
  steps: RunStep[]
  replyTo: string | null
  createdAt: number
  updatedAt: number
}

/** Edge condition as a short human-readable label. */
export function whenLabel(w?: EdgeWhen): string {
  if (!w) return ''
  const parts: string[] = []
  if (w.status) parts.push(w.status === 'done' ? '成功' : '失敗')
  if (w.hasMrUrl !== undefined) parts.push(w.hasMrUrl ? '有 PR' : '無 PR')
  if (w.label) parts.push(`結論=${w.label}`)
  return parts.join(' · ')
}

export const useWorkflowsStore = defineStore('workflows', {
  state: () => ({ workflows: [] as WorkflowSummary[], loading: false }),
  actions: {
    async fetch() {
      this.loading = true
      try {
        const { data } = await workflowsApi.list()
        this.workflows = data
      } finally {
        this.loading = false
      }
    },
    nameOf(id?: string | null) {
      return this.workflows.find((w) => w.id === id)?.name
    },
  },
})
