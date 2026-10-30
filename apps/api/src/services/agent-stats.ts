// Per-agent monitoring numbers (system-integration-design.md §6): liveness,
// brain version, queue depth, last-24h outcomes / duration / cost, current step.
import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { agentRuns, agents, queues, workflowRuns, workflowSteps, workflows } from "../db/schema.js";
import { withOnline } from "./agents.js";

const DAY_MS = 86_400_000;

async function queueDepth(app: FastifyInstance, queueName: string | null): Promise<number | null> {
  if (!queueName) return null;
  try {
    const c = await app.getQueue(queueName).getJobCounts("waiting", "delayed", "prioritized");
    return (c.waiting ?? 0) + (c.delayed ?? 0) + (c.prioritized ?? 0);
  } catch {
    return null; // Redis unavailable: show unknown rather than failing the page
  }
}

export async function agentOverview(app: FastifyInstance, ownerId: string, onlyAgentId?: string) {
  const filters = [eq(agents.ownerId, ownerId)];
  if (onlyAgentId) filters.push(eq(agents.id, onlyAgentId));
  const rows = await app.db
    .select({ agent: agents, queueName: queues.name })
    .from(agents)
    .leftJoin(queues, eq(agents.queueId, queues.id))
    .where(and(...filters));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.agent.id);

  const since = Date.now() - DAY_MS;
  const stats = await app.db
    .select({
      agentId: agentRuns.agentId,
      done: sql<number>`count(*) filter (where ${agentRuns.status} = 'done')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${agentRuns.status} = 'failed')`.mapWith(Number),
      avgDurationMs: sql<number | null>`avg(${agentRuns.durationMs})`.mapWith((v) => (v == null ? null : Math.round(Number(v)))),
      costUsd: sql<number>`coalesce(sum(${agentRuns.costUsd}), 0)`.mapWith(Number),
    })
    .from(agentRuns)
    .where(and(inArray(agentRuns.agentId, ids), gte(agentRuns.startedAt, since)))
    .groupBy(agentRuns.agentId);
  const statsBy = new Map(stats.map((s) => [s.agentId, s]));

  const current = await app.db
    .select({ agentId: workflowSteps.agentId, runId: workflowSteps.runId, node: workflowSteps.node, workflowName: workflows.name })
    .from(workflowSteps)
    .innerJoin(workflowRuns, eq(workflowRuns.id, workflowSteps.runId))
    .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
    // only live runs: a step left "running" by a cancelled run or a crashed agent isn't current work
    .where(and(inArray(workflowSteps.agentId, ids), eq(workflowSteps.status, "running"), eq(workflowRuns.status, "running")))
    .orderBy(desc(workflowSteps.startedAt));
  const currentBy = new Map<string, (typeof current)[number]>();
  for (const c of current) if (c.agentId && !currentBy.has(c.agentId)) currentBy.set(c.agentId, c);

  return Promise.all(
    rows.map(async ({ agent, queueName }) => {
      const { apiToken: _t, instruction: _i, ...view } = withOnline(agent);
      const s = statsBy.get(agent.id);
      const c = currentBy.get(agent.id);
      return {
        ...view,
        queueName,
        queueDepth: await queueDepth(app, queueName),
        last24h: { done: s?.done ?? 0, failed: s?.failed ?? 0, avgDurationMs: s?.avgDurationMs ?? null, costUsd: s?.costUsd ?? 0 },
        currentStep: c ? { runId: c.runId, workflowName: c.workflowName, node: c.node } : null,
      };
    }),
  );
}

/** What template's "my work" panel shows: queue, recent runs, and runs waiting on a human at this agent. */
export async function agentWork(app: FastifyInstance, agentId: string, ownerId: string) {
  const [overview] = await agentOverview(app, ownerId, agentId);
  const recent = await app.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.agentId, agentId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(20);

  // Interrupted runs whose current node is assigned to this agent.
  const interrupted = await app.db
    .select({ runId: workflowRuns.id, workflowName: workflows.name, node: workflowRuns.currentNode, updatedAt: workflowRuns.updatedAt })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
    .innerJoin(
      workflowSteps,
      and(eq(workflowSteps.runId, workflowRuns.id), eq(workflowSteps.node, workflowRuns.currentNode), eq(workflowSteps.agentId, agentId)),
    )
    .where(and(eq(workflowRuns.ownerId, ownerId), eq(workflowRuns.status, "interrupted")))
    .groupBy(workflowRuns.id, workflows.name)
    .orderBy(desc(workflowRuns.updatedAt));

  // What stopped it: a gate (let through from agent-manager) or blocked actions (finished here,
  // attended — §4.5). The latest step carries both the kind and the blocked list.
  const needsHuman = await Promise.all(
    interrupted.map(async (r) => {
      const [last] = await app.db
        .select({ kind: workflowSteps.kind, input: workflowSteps.input, result: workflowSteps.result })
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, r.runId))
        .orderBy(desc(workflowSteps.seq))
        .limit(1);
      const result = last?.result ? (JSON.parse(last.result) as { blocked?: Array<{ tool: string; summary: string }> }) : null;
      return {
        ...r,
        reason: last?.kind === "gate" ? ("gate" as const) : ("blocked" as const),
        blocked: result?.blocked ?? [],
        input: last?.input ?? null,
      };
    }),
  );

  return { queueDepth: overview?.queueDepth ?? null, last24h: overview?.last24h ?? null, recent, needsHuman };
}
