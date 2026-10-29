<template>
  <div class="wf-canvas">
    <VueFlow
      :id="flowId"
      :nodes="flowNodes"
      :edges="flowEdges"
      :nodes-draggable="editable"
      :nodes-connectable="editable"
      :elements-selectable="true"
      :default-viewport="{ zoom: 1 }"
      :min-zoom="0.3"
      :max-zoom="1.6"
      :delete-key-code="null"
      @connect="onConnect"
      @node-click="onNodeClick"
      @edge-click="onEdgeClick"
      @node-drag-stop="onDragStop"
      @pane-click="emit('select', null)"
    >
      <template #node-terminal="{ data }">
        <div class="terminal" :class="data.kind">
          <Handle v-if="data.kind === 'start'" type="source" :position="Position.Right" />
          <Handle v-if="data.kind === 'end'" type="target" :position="Position.Left" />
          {{ data.kind === 'start' ? 'START' : 'END' }}
        </div>
      </template>

      <template #node-step="{ id, data }">
        <div class="step" :class="[data.status, { selected: selected?.kind === 'node' && selected.id === id }]">
          <Handle type="target" :position="Position.Left" />
          <div class="step-head">
            <span class="step-id">{{ id }}</span>
            <span v-if="data.interruptBefore" class="gate" title="執行前停下來等人工放行">⏸</span>
          </div>
          <div class="step-agent">{{ data.agentName }}</div>
          <div v-if="data.labels?.length" class="step-labels">
            <span v-for="l in data.labels" :key="l" class="label-tag">{{ l }}</span>
          </div>
          <div v-if="data.statusText" class="step-status">{{ data.statusText }}</div>
          <Handle type="source" :position="Position.Right" />
          <!-- loops (edges back to an earlier node) leave and enter at the bottom -->
          <Handle id="loop-out" type="source" :position="Position.Bottom" class="loop-handle" :connectable="false" />
          <Handle id="loop-in" type="target" :position="Position.Bottom" class="loop-handle" :connectable="false" />
        </div>
      </template>
    </VueFlow>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { VueFlow, Handle, Position, MarkerType, useVueFlow, type Connection, type Edge, type Node } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import { END, whenLabel, type WorkflowGraph } from '@/stores/workflows'

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; index: number } | null
/** Per-node run state, for the read-only view on the run page. */
export type NodeRunState = { status: 'done' | 'failed' | 'current' | 'waiting'; text?: string }

const START = '__start__'

const props = defineProps<{
  graph: WorkflowGraph
  agentNames?: Record<string, string>
  editable?: boolean
  selected?: Selection
  nodeStates?: Record<string, NodeRunState>
}>()

// Each canvas gets its own Vue Flow store (the editor and the run page can both be mounted).
const flowId = `wf-${Math.random().toString(36).slice(2, 9)}`
const { fitView, onNodesInitialized } = useVueFlow(flowId)
// Fit once the nodes have been measured (fit-view-on-init runs before the container has its size).
onNodesInitialized(() => fitView({ padding: 0.15, maxZoom: 1.1 }))

const emit = defineEmits<{
  select: [sel: Selection]
  connect: [from: string, to: string] // from = node id, or '' for START (sets entry)
  move: [nodeId: string, position: { x: number; y: number }]
}>()

/** Layered auto-layout for nodes without a saved position: column = BFS depth from entry. */
const layout = computed(() => {
  const depth = new Map<string, number>()
  const order: string[] = []
  if (props.graph.nodes.some((n) => n.id === props.graph.entry)) {
    depth.set(props.graph.entry, 0)
    order.push(props.graph.entry)
  }
  for (let i = 0; i < order.length; i++) {
    for (const e of props.graph.edges) {
      if (e.from === order[i] && e.to !== END && !depth.has(e.to)) {
        depth.set(e.to, depth.get(order[i])! + 1)
        order.push(e.to)
      }
    }
  }
  let unreached = Math.max(0, ...depth.values()) + 1
  for (const n of props.graph.nodes) if (!depth.has(n.id)) depth.set(n.id, unreached++)
  const rows = new Map<number, number>()
  const pos: Record<string, { x: number; y: number }> = {}
  for (const n of props.graph.nodes) {
    const d = depth.get(n.id)!
    const row = rows.get(d) ?? 0
    rows.set(d, row + 1)
    pos[n.id] = n.position ?? { x: 160 + d * 240, y: 40 + row * 130 }
  }
  const maxX = Math.max(160, ...Object.values(pos).map((p) => p.x))
  return { pos, endX: maxX + 260 }
})

// Re-fit when nodes are added or removed (not on every drag).
watch(
  () => props.graph.nodes.length,
  () => setTimeout(() => fitView({ padding: 0.15, maxZoom: 1.1 }), 50),
)

const flowNodes = computed<Node[]>(() => [
  { id: START, type: 'terminal', position: { x: 0, y: 70 }, data: { kind: 'start' }, draggable: false, selectable: false },
  ...props.graph.nodes.map((n) => {
    const st = props.nodeStates?.[n.id]
    return {
      id: n.id,
      type: 'step',
      position: layout.value.pos[n.id],
      data: {
        agentName: props.agentNames?.[n.agentId] ?? n.agentId.slice(0, 8),
        labels: n.labels,
        interruptBefore: n.interruptBefore,
        status: st?.status ?? '',
        statusText: st?.text,
      },
    }
  }),
  { id: END, type: 'terminal', position: { x: layout.value.endX, y: 70 }, data: { kind: 'end' }, draggable: false, selectable: false },
])

const flowEdges = computed<Edge[]>(() => [
  ...(props.graph.entry
    ? [{ id: 'entry', source: START, target: props.graph.entry, selectable: false, class: 'entry-edge', markerEnd: MarkerType.ArrowClosed }]
    : []),
  ...props.graph.edges.map((e, i) => {
    const fromCount = props.graph.edges.filter((x) => x.from === e.from).length
    const cond = whenLabel(e.when)
    // Order matters (first match wins): number edges when a node has more than one way out.
    const label = [fromCount > 1 ? `#${props.graph.edges.filter((x, j) => x.from === e.from && j <= i).length}` : '', cond]
      .filter(Boolean)
      .join(' ')
    const isSelected = props.selected?.kind === 'edge' && props.selected.index === i
    // Edges that go back (loops) route around below instead of over the forward edges.
    const from = layout.value.pos[e.from]
    const to = e.to === END ? undefined : layout.value.pos[e.to]
    const backwards = Boolean(from && to && to.x <= from.x)
    return {
      id: `e${i}`,
      source: e.from,
      target: e.to,
      type: backwards ? 'smoothstep' : 'default',
      ...(backwards ? { sourceHandle: 'loop-out', targetHandle: 'loop-in', pathOptions: { offset: 36, borderRadius: 10 } } : {}),
      label: label || undefined,
      markerEnd: MarkerType.ArrowClosed,
      class: isSelected ? 'selected-edge' : '',
      animated: isSelected,
    }
  }),
])

function onConnect(c: Connection) {
  if (!props.editable || !c.source || !c.target) return
  emit('connect', c.source === START ? '' : c.source, c.target)
}

function onNodeClick({ node }: { node: Node }) {
  if (node.id === START || node.id === END) return
  emit('select', { kind: 'node', id: node.id })
}

function onEdgeClick({ edge }: { edge: Edge }) {
  if (!edge.id.startsWith('e')) return
  emit('select', { kind: 'edge', index: Number(edge.id.slice(1)) })
}

function onDragStop({ node }: { node: Node }) {
  if (node.id === START || node.id === END) return
  emit('move', node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) })
}
</script>

<style scoped>
.wf-canvas { width: 100%; height: 100%; min-height: 360px; background: var(--bg); }
.terminal {
  padding: 8px 14px; border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: .06em;
  border: 1px solid var(--border2); background: var(--surface2); color: var(--text2);
}
.terminal.start { color: var(--blue); border-color: rgba(96,165,250,.4); }
.terminal.end { color: var(--accent); border-color: rgba(110,231,183,.4); }
.step {
  min-width: 170px; max-width: 220px; padding: 10px 12px; border-radius: var(--radius);
  background: var(--surface); border: 1px solid var(--border2); color: var(--text); text-align: left;
}
.step.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-bg); }
.step.done { border-color: rgba(110,231,183,.5); }
.step.failed { border-color: rgba(248,113,113,.6); background: var(--red-bg); }
.step.current { border-color: var(--yellow); box-shadow: 0 0 0 2px var(--yellow-bg); }
.step.waiting { border-color: var(--yellow); background: var(--yellow-bg); }
.step-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.step-id { font-weight: 600; font-size: 13px; font-family: ui-monospace, monospace; }
.gate { color: var(--yellow); font-size: 12px; }
.step-agent { font-size: 11px; color: var(--text2); margin-top: 2px; }
.step-labels { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.label-tag { font-size: 10px; padding: 1px 6px; border-radius: 10px; background: var(--blue-bg); color: var(--blue); }
.step-status { font-size: 11px; color: var(--text2); margin-top: 6px; }

:deep(.vue-flow__edge-path) { stroke: var(--text3); stroke-width: 1.5; }
:deep(.entry-edge .vue-flow__edge-path) { stroke-dasharray: 4 3; }
:deep(.selected-edge .vue-flow__edge-path) { stroke: var(--accent); stroke-width: 2.5; }
:deep(.vue-flow__edge-textbg) { fill: var(--surface2); }
:deep(.vue-flow__edge-text) { fill: var(--text2); font-size: 11px; }
:deep(.vue-flow__handle) { width: 8px; height: 8px; background: var(--text3); border: 1px solid var(--border2); }
:deep(.vue-flow__node) { cursor: pointer; }
:deep(.vue-flow__handle.loop-handle) { opacity: 0; pointer-events: none; }
</style>
