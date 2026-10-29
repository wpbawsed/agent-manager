// Pure workflow logic (no DB, no queue): graph validation, input templates,
// edge selection and state merging. LangGraph's model, borrowed — not the library
// (system-integration-design.md §4).

export const END = "END";
export const DEFAULT_MAX_STEPS = 10;
export const MAX_RETRIES = 3;
export const RETRY_DELAYS_MS = [60_000, 300_000, 900_000];

export interface WorkflowNode {
  id: string;
  agentId: string;
  input: string;              // template: {{input.*}}, {{nodes.<id>.summary|mrUrl|status|label}}, {{human}}
  labels?: string[];          // when set, the agent must end its reply with "結論：<label>"
  interruptBefore?: boolean;  // stop and wait for a human before running this node
}

export interface EdgeWhen {
  status?: "done" | "failed";
  hasMrUrl?: boolean;
  label?: string;
}

export interface WorkflowEdge {
  from: string;
  to: string; // node id or END
  when?: EdgeWhen;
}

export interface WorkflowGraph {
  entry: string;
  maxSteps?: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface BlockedAction {
  tool: string;
  summary: string;
}

/** What one step produced, as recorded in run state. */
export interface StepResult {
  node: string;
  status: "done" | "failed";
  summary?: string;
  mrUrl?: string;
  label?: string;
  error?: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  blocked?: BlockedAction[];
  unavailable?: boolean;
}

export interface RunState {
  input: Record<string, unknown>; // origin event payload, including raw
  nodes: Record<string, StepResult>; // latest result per node (overwritten on revisit)
  history: StepResult[]; // every step, append-only
}

const NODE_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/** Returns human-readable problems; empty array = valid. */
export function validateGraph(g: unknown, knownAgentIds?: Set<string>): string[] {
  const errors: string[] = [];
  if (!g || typeof g !== "object") return ["graph must be an object"];
  const graph = g as Partial<WorkflowGraph>;
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) errors.push("nodes must be a non-empty array");
  if (!Array.isArray(graph.edges)) errors.push("edges must be an array");
  if (errors.length) return errors;

  const ids = new Set<string>();
  for (const n of graph.nodes!) {
    if (!n || typeof n.id !== "string" || !NODE_ID.test(n.id)) {
      errors.push(`invalid node id: ${JSON.stringify(n?.id)}`);
      continue;
    }
    if (n.id === END) errors.push(`node id "${END}" is reserved`);
    if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    ids.add(n.id);
    if (typeof n.agentId !== "string" || !n.agentId) errors.push(`node ${n.id}: agentId is required`);
    else if (knownAgentIds && !knownAgentIds.has(n.agentId)) errors.push(`node ${n.id}: unknown agent ${n.agentId}`);
    if (typeof n.input !== "string" || !n.input.trim()) errors.push(`node ${n.id}: input is required`);
    if (n.labels !== undefined) {
      if (!Array.isArray(n.labels) || n.labels.length === 0 || n.labels.some((l) => typeof l !== "string" || !/^\S+$/.test(l)))
        errors.push(`node ${n.id}: labels must be non-empty strings without spaces`);
    }
  }
  if (typeof graph.entry !== "string" || !ids.has(graph.entry)) errors.push(`entry must be one of the node ids`);
  if (graph.maxSteps !== undefined && (!Number.isInteger(graph.maxSteps) || graph.maxSteps < 1 || graph.maxSteps > 100))
    errors.push("maxSteps must be an integer between 1 and 100");

  const byId = new Map(graph.nodes!.map((n) => [n?.id, n]));
  for (const e of graph.edges!) {
    if (!e || !ids.has(e.from)) {
      errors.push(`edge from unknown node: ${JSON.stringify(e?.from)}`);
      continue;
    }
    if (e.to !== END && !ids.has(e.to)) errors.push(`edge ${e.from} → unknown node: ${JSON.stringify(e.to)}`);
    const w = e.when;
    if (w === undefined) continue;
    if (typeof w !== "object" || w === null) {
      errors.push(`edge ${e.from} → ${e.to}: when must be an object`);
      continue;
    }
    if (w.status !== undefined && w.status !== "done" && w.status !== "failed")
      errors.push(`edge ${e.from} → ${e.to}: status must be "done" or "failed"`);
    if (w.hasMrUrl !== undefined && typeof w.hasMrUrl !== "boolean")
      errors.push(`edge ${e.from} → ${e.to}: hasMrUrl must be boolean`);
    if (w.label !== undefined && !byId.get(e.from)?.labels?.includes(w.label))
      errors.push(`edge ${e.from} → ${e.to}: label "${w.label}" is not one of ${e.from}'s labels`);
  }
  return errors;
}

export function nodeOf(graph: WorkflowGraph, id: string): WorkflowNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

function lookup(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Fills {{input.x}}, {{nodes.id.field}}, {{human}}. Unknown paths become "". */
export function fillTemplate(template: string, state: RunState, human?: string): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, path: string) => {
    const [root, ...rest] = path.split(".");
    const value =
      root === "human" && rest.length === 0 ? human
      : root === "input" ? lookup(state.input, rest)
      : root === "nodes" ? lookup(state.nodes, rest)
      : undefined;
    if (value == null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

/** The prompt actually sent to a node's agent. */
export function buildInput(node: WorkflowNode, state: RunState, human?: string): string {
  const parts = [fillTemplate(node.input, state, human).trim()];
  if (human && !node.input.includes("{{human}}")) parts.push(`\n\n人工回覆：\n${human}`);
  if (node.labels?.length)
    parts.push(`\n\n在「## 回覆」的最後一行寫 \`結論：<${node.labels.join("|")}>\`，只能從這幾個值選一個。`);
  return parts.join("");
}

/** Last "結論：x" (or "結論: x") line in the summary, if x is one of the labels. */
export function parseLabel(summary: string | undefined, labels: string[] | undefined): string | undefined {
  if (!summary || !labels?.length) return undefined;
  const matches = [...summary.matchAll(/結論\s*[:：]\s*`?([^\s`]+)`?/g)];
  const last = matches.at(-1)?.[1];
  return last && labels.includes(last) ? last : undefined;
}

function edgeMatches(when: EdgeWhen | undefined, r: StepResult): boolean {
  if (!when) return true;
  if (when.status !== undefined && when.status !== r.status) return false;
  if (when.hasMrUrl !== undefined && when.hasMrUrl !== Boolean(r.mrUrl)) return false;
  if (when.label !== undefined && when.label !== r.label) return false;
  return true;
}

/**
 * Next node after `from`, given its result. First matching edge wins (in order).
 * No match: done → END, failed → null (the run fails).
 */
export function selectNext(graph: WorkflowGraph, from: string, result: StepResult): string | null {
  for (const e of graph.edges) {
    if (e.from === from && edgeMatches(e.when, result)) return e.to;
  }
  return result.status === "done" ? END : null;
}

/** raw is kept: for GitHub / Jira the actual request text only exists there ({{input.raw.comment.body}}). */
export function initialState(payload: Record<string, unknown> | undefined): RunState {
  return { input: { ...(payload ?? {}) }, nodes: {}, history: [] };
}

export function mergeState(state: RunState, result: StepResult): RunState {
  return {
    input: state.input,
    nodes: { ...state.nodes, [result.node]: result },
    history: [...state.history, result],
  };
}
