// Workflow engine: event-driven, lives inside the API process. A step result
// arriving (PATCH .../events/:eventId with a "wf_" id) drives the next enqueue.
// Agents never know they are in a workflow (system-integration-design.md §4.9).
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Queue } from "bullmq";
import type { DB } from "../db/client.js";
import {
  agents,
  queues,
  replyContexts,
  workflowRuns,
  workflowSteps,
  workflowVersions,
  workflows,
} from "../db/schema.js";
import {
  resolveIssueKey,
  runNotice,
  runReply,
  type ReplyPolicyLogger,
} from "../lib/reply-policy.js";
import { recordRunEnd, recordRunStart } from "../lib/agent-runs.js";
import {
  DEFAULT_MAX_STEPS,
  END,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  buildInput,
  initialState,
  mergeState,
  nodeOf,
  parseLabel,
  selectNext,
  type BlockedAction,
  type RunState,
  type StepResult,
  type WorkflowGraph,
} from "./graph.js";

// Links in "waiting for review" notices point at the UI, which may be a separate service from the API.
const UI_PUBLIC_URL =
  process.env.UI_PUBLIC_URL || process.env.MANAGER_PUBLIC_URL || process.env.API_SERVER_URL || "http://localhost:3000";

export interface EngineDeps {
  db: DB;
  getQueue: (queueName: string) => Queue;
  log: ReplyPolicyLogger;
}

type RunRow = typeof workflowRuns.$inferSelect;
type StepKind = "run" | "retry" | "resume" | "gate";

/** What an agent reports when a step finishes (superset of AgentResultLite). */
export interface ReportedResult {
  status?: "success" | "failed";
  summary?: string;
  mrUrl?: string;
  error?: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  blocked?: BlockedAction[];
  unavailable?: boolean;
}

export const isWorkflowEventId = (eventId: string) => eventId.startsWith("wf_");
export const runUrl = (runId: string) => `${UI_PUBLIC_URL.replace(/\/$/, "")}/workflow-runs/${runId}`;

async function graphOf(db: DB, versionId: string): Promise<WorkflowGraph> {
  const [v] = await db.select({ graph: workflowVersions.graph }).from(workflowVersions).where(eq(workflowVersions.id, versionId)).limit(1);
  if (!v) throw new Error(`workflow version ${versionId} not found`);
  return JSON.parse(v.graph) as WorkflowGraph;
}

async function updateRun(db: DB, runId: string, patch: Partial<RunRow>): Promise<void> {
  await db.update(workflowRuns).set({ ...patch, updatedAt: Date.now() }).where(eq(workflowRuns.id, runId));
}

// ── start ──────────────────────────────────────────────────────────────────

export interface StartRunArgs {
  ownerId: string;
  workflowId: string;
  ruleId?: string;
  event: { eventId: string; brokerId: string; sourceType: string; payload?: Record<string, unknown> };
  replyTo: string | null;
  replyPolicy: string | null; // JSON ReplyPolicy from the rule
}

export async function startRun(deps: EngineDeps, args: StartRunArgs): Promise<string> {
  const { db } = deps;
  const [wf] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, args.workflowId), eq(workflows.ownerId, args.ownerId)))
    .limit(1);
  if (!wf?.currentVersionId) throw new Error(`workflow ${args.workflowId} not found or has no version`);

  const now = Date.now();
  const [run] = await db
    .insert(workflowRuns)
    .values({
      id: randomUUID(),
      ownerId: args.ownerId,
      workflowId: wf.id,
      versionId: wf.currentVersionId,
      originEventId: args.event.eventId,
      brokerId: args.event.brokerId,
      ruleId: args.ruleId ?? null,
      sourceType: args.event.sourceType,
      replyTo: args.replyTo,
      replyPolicy: args.replyPolicy,
      status: "running",
      state: JSON.stringify(initialState(args.event.payload)),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const graph = await graphOf(db, run.versionId);
  await enqueueNode(deps, run, graph, graph.entry, "run");
  return run.id;
}

// ── enqueue ────────────────────────────────────────────────────────────────

async function nextSeq(db: DB, runId: string): Promise<number> {
  const [last] = await db
    .select({ seq: workflowSteps.seq })
    .from(workflowSteps)
    .where(eq(workflowSteps.runId, runId))
    .orderBy(desc(workflowSteps.seq))
    .limit(1);
  return (last?.seq ?? 0) + 1;
}

async function enqueueNode(
  deps: EngineDeps,
  run: RunRow,
  graph: WorkflowGraph,
  nodeId: string,
  kind: Exclude<StepKind, "gate">,
  opts: { human?: string; attempt?: number; delayMs?: number } = {},
): Promise<void> {
  const { db } = deps;
  const node = nodeOf(graph, nodeId);
  if (!node) return failRun(deps, run, `node ${nodeId} not in graph`);

  const maxSteps = graph.maxSteps ?? DEFAULT_MAX_STEPS;
  if (kind === "run" && run.steps >= maxSteps) return failRun(deps, run, `超過 maxSteps（${maxSteps}）`);

  const now = Date.now();
  if (node.interruptBefore && kind === "run") {
    const seq = await nextSeq(db, run.id);
    await db.insert(workflowSteps).values({
      id: randomUUID(),
      runId: run.id,
      seq,
      node: node.id,
      agentId: node.agentId,
      eventId: `wf_${run.id}_${seq}`,
      kind: "gate",
      status: "interrupted",
      createdAt: now,
    });
    await updateRun(db, run.id, { status: "interrupted", currentNode: node.id });
    notifyInterrupted(deps, run, `⏸ 工作流停在「${node.id}」之前，等待人工放行：${runUrl(run.id)}`);
    return;
  }

  const [target] = await db
    .select({ queueName: queues.name })
    .from(agents)
    .innerJoin(queues, eq(agents.queueId, queues.id))
    .where(and(eq(agents.id, node.agentId), eq(agents.ownerId, run.ownerId)))
    .limit(1);
  if (!target) return failRun(deps, run, `node ${node.id}: agent ${node.agentId} 不存在或沒有綁 queue`);

  const state = JSON.parse(run.state) as RunState;
  const input = buildInput(node, state, opts.human);
  const seq = await nextSeq(db, run.id);
  const eventId = `wf_${run.id}_${seq}`;

  await db.insert(workflowSteps).values({
    id: randomUUID(),
    runId: run.id,
    seq,
    node: node.id,
    agentId: node.agentId,
    eventId,
    kind,
    attempt: opts.attempt ?? 1,
    status: "queued",
    input,
    human: opts.human ?? null,
    createdAt: now,
  });
  const steps = kind === "run" ? run.steps + 1 : run.steps;
  await updateRun(db, run.id, { status: "running", currentNode: node.id, steps });

  await deps.getQueue(target.queueName).add(
    "agent-event",
    {
      eventId,
      brokerId: run.brokerId ?? "",
      sourceType: run.sourceType ?? "workflow",
      eventType: "workflow.step",
      // conversationKey: revisits and resumes of the same node continue the same agent Session
      payload: { text: input, conversationKey: `wf:${run.id}:${node.id}` },
      replyTo: run.replyTo ?? "",
      ts: now,
    },
    {
      jobId: eventId,
      delay: opts.delayMs,
      attempts: 1, // the engine owns retries (kind=retry), not BullMQ
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
    },
  );
}

// ── step lifecycle (called from the event routes) ──────────────────────────

/** Returns the agent the step was sent to, so callers can book agent_runs. */
export async function onStepStarted(deps: EngineDeps, eventId: string): Promise<string | null> {
  const { db } = deps;
  const [step] = await db.select().from(workflowSteps).where(eq(workflowSteps.eventId, eventId)).limit(1);
  if (!step) return null;
  if (step.status === "queued")
    await db.update(workflowSteps).set({ status: "running", startedAt: Date.now() }).where(eq(workflowSteps.id, step.id));
  if (step.agentId) await recordRunStart(db, step.agentId, eventId);
  return step.agentId;
}

export async function onStepFinished(
  deps: EngineDeps,
  eventId: string,
  reportedStatus: "done" | "failed",
  reported: ReportedResult = {},
): Promise<void> {
  const { db } = deps;
  const [step] = await db.select().from(workflowSteps).where(eq(workflowSteps.eventId, eventId)).limit(1);
  if (!step || step.status === "done" || step.status === "failed") return; // unknown or already handled

  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, step.runId)).limit(1);
  if (!run) return;
  const graph = await graphOf(db, run.versionId);
  const node = nodeOf(graph, step.node);

  const ok = reportedStatus === "done" && reported.status === "success";
  const result: StepResult = {
    node: step.node,
    status: ok ? "done" : "failed",
    summary: reported.summary,
    mrUrl: reported.mrUrl,
    error: reported.error,
    costUsd: reported.costUsd,
    durationMs: reported.durationMs,
    numTurns: reported.numTurns,
    blocked: reported.blocked?.length ? reported.blocked : undefined,
    unavailable: reported.unavailable || undefined,
  };
  if (ok && node?.labels?.length) {
    result.label = parseLabel(reported.summary, node.labels);
    if (!result.label) {
      result.status = "failed";
      result.error = `沒有解析到結論標籤（應為 ${node.labels.join("|")} 之一）`;
    }
  }

  await db
    .update(workflowSteps)
    .set({ status: result.status, result: JSON.stringify(result), endedAt: Date.now() })
    .where(eq(workflowSteps.id, step.id));
  if (step.agentId) await recordRunEnd(db, step.agentId, eventId, result.status, result);

  // A cancelled / finished run still records the step, but goes no further.
  if (run.status !== "running") return;

  if (result.unavailable && step.attempt <= MAX_RETRIES) {
    return enqueueNode(deps, run, graph, step.node, "retry", {
      human: step.human ?? undefined,
      attempt: step.attempt + 1,
      delayMs: RETRY_DELAYS_MS[step.attempt - 1],
    });
  }

  const state = mergeState(JSON.parse(run.state) as RunState, result);
  const withState: RunRow = { ...run, state: JSON.stringify(state) };
  await updateRun(db, run.id, { state: withState.state });

  if (result.blocked?.length) {
    await updateRun(db, run.id, { status: "interrupted" });
    const actions = result.blocked.map((b) => `• ${b.tool}：${b.summary}`).join("\n");
    notifyInterrupted(deps, run, `⏸ 工作流在「${step.node}」碰到需要核准的動作，等待審查：${runUrl(run.id)}\n${actions}`);
    return;
  }

  const next = selectNext(graph, step.node, result);
  if (next === null) return failRun(deps, withState, result.error || `「${step.node}」失敗，且沒有接 status=failed 的邊`);
  if (next === END) return completeRun(deps, withState, result);
  return enqueueNode(deps, withState, graph, next, "run");
}

// ── human actions ──────────────────────────────────────────────────────────

export async function resumeRun(deps: EngineDeps, runId: string, ownerId: string, message?: string): Promise<string | null> {
  const { db } = deps;
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.ownerId, ownerId)))
    .limit(1);
  if (!run) return "Run not found";
  if (run.status !== "interrupted" || !run.currentNode) return `Run is ${run.status}, not interrupted`;
  const graph = await graphOf(db, run.versionId);
  await enqueueNode(deps, run, graph, run.currentNode, "resume", { human: message?.trim() || undefined });
  return null;
}

export async function cancelRun(deps: EngineDeps, runId: string, ownerId: string): Promise<string | null> {
  const { db } = deps;
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.ownerId, ownerId)))
    .limit(1);
  if (!run) return "Run not found";
  if (run.status === "done" || run.status === "failed" || run.status === "cancelled") return `Run is already ${run.status}`;
  await updateRun(db, run.id, { status: "cancelled" });
  // Best effort: drop a step that hasn't been picked up yet.
  const [step] = await db
    .select()
    .from(workflowSteps)
    .where(and(eq(workflowSteps.runId, run.id), eq(workflowSteps.status, "queued")))
    .limit(1);
  if (step?.agentId) {
    const [target] = await db
      .select({ queueName: queues.name })
      .from(agents)
      .innerJoin(queues, eq(agents.queueId, queues.id))
      .where(eq(agents.id, step.agentId))
      .limit(1);
    if (target) await deps.getQueue(target.queueName).remove(step.eventId).catch(() => 0);
  }
  return null;
}

// ── endings ────────────────────────────────────────────────────────────────

function notifyInterrupted(deps: EngineDeps, run: RunRow, text: string): void {
  if (run.brokerId) runNotice(deps.db, { brokerId: run.brokerId, replyTo: run.replyTo, text }, deps.log);
}

/** Final reply goes through the existing reply policy (reply_contexts + runReply). */
async function reply(deps: EngineDeps, run: RunRow, result: { status: "success" | "failed"; summary?: string; mrUrl?: string; error?: string }) {
  if (!run.replyPolicy || !run.brokerId) return;
  const eventId = `wf_${run.id}_end`;
  await deps.db
    .insert(replyContexts)
    .values({
      eventId,
      brokerId: run.brokerId,
      replyTo: run.replyTo,
      jiraIssueKey: resolveIssueKey(run.replyTo) ?? null,
      policy: run.replyPolicy,
      createdAt: Date.now(),
    })
    .onConflictDoNothing();
  runReply(deps.db, eventId, result, deps.log);
}

async function completeRun(deps: EngineDeps, run: RunRow, last: StepResult): Promise<void> {
  await updateRun(deps.db, run.id, { status: "done", currentNode: null, state: run.state });
  await reply(deps, run, { status: "success", summary: last.summary, mrUrl: last.mrUrl });
}

async function failRun(deps: EngineDeps, run: RunRow, error: string): Promise<void> {
  await updateRun(deps.db, run.id, { status: "failed", error, state: run.state });
  await reply(deps, run, { status: "failed", error });
}
