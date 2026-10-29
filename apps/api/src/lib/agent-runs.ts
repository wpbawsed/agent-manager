import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { agentRuns, agents } from "../db/schema.js";

// agent_runs bookkeeping: one row per (agent, event). Written by the per-agent
// event routes, and by the workflow engine for steps reported over the legacy
// shared-token route (the step knows which agent it was sent to).

export interface RunMetrics {
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  error?: string;
}

export async function recordRunStart(db: DB, agentId: string, eventId: string): Promise<void> {
  const [agent] = await db.select({ ownerId: agents.ownerId }).from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return;
  await db
    .insert(agentRuns)
    .values({ id: randomUUID(), agentId, ownerId: agent.ownerId, eventId, status: "running", startedAt: Date.now() })
    .onConflictDoNothing();
}

export async function recordRunEnd(
  db: DB,
  agentId: string,
  eventId: string,
  status: "done" | "failed",
  m: RunMetrics,
): Promise<void> {
  // A finish without a start (agent restarted mid-run, or start was dropped) still counts.
  await recordRunStart(db, agentId, eventId);
  await db
    .update(agentRuns)
    .set({
      status,
      costUsd: num(m.costUsd),
      durationMs: num(m.durationMs, true),
      numTurns: num(m.numTurns, true),
      error: m.error ? m.error.slice(0, 2000) : null,
      endedAt: Date.now(),
    })
    .where(and(eq(agentRuns.agentId, agentId), eq(agentRuns.eventId, eventId)));
}

function num(v: unknown, int = false): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return int ? Math.round(v) : v;
}
