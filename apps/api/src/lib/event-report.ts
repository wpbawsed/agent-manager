// Shared handling for "an agent started / finished an event", behind both the
// legacy shared-token routes (/internal/events) and the per-agent routes
// (/internal/agents/:id/events). Workflow steps ("wf_" eventIds) go to the
// engine; everything else keeps the original webhook_events + reply-policy flow.
//
// Trust: the legacy routes hold the shared INTERNAL_TOKEN (trusted infra, any event).
// On the per-agent routes the caller is one agent, so it may only report on its own
// workflow steps and on events that belong to its owner.
import { and, eq, or } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { agents, brokers, replyContexts, webhookEvents } from "../db/schema.js";
import { runReply } from "./reply-policy.js";
import { recordRunEnd, recordRunStart } from "./agent-runs.js";
import {
  isWorkflowEventId,
  onStepFinished,
  onStepStarted,
  type EngineDeps,
  type ReportedResult,
} from "../workflow/engine.js";

export interface EventStart {
  eventId: string;
  brokerId: string;
  sourceType?: string;
  eventType?: string;
  agentId?: string; // set on the per-agent route only
}

async function ownerOf(db: DB, agentId: string): Promise<string | null> {
  const [a] = await db.select({ ownerId: agents.ownerId }).from(agents).where(eq(agents.id, agentId)).limit(1);
  return a?.ownerId ?? null;
}

/** Does this (non-workflow) event belong to ownerId? Known from the webhook log row or the reply context's broker. */
async function eventBelongsTo(db: DB, eventId: string, ownerId: string): Promise<boolean> {
  const [logged] = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.id, eventId), eq(webhookEvents.ownerId, ownerId)))
    .limit(1);
  if (logged) return true;
  const [ctx] = await db
    .select({ id: replyContexts.eventId })
    .from(replyContexts)
    .innerJoin(brokers, eq(brokers.id, replyContexts.brokerId))
    .where(and(eq(replyContexts.eventId, eventId), eq(brokers.ownerId, ownerId)))
    .limit(1);
  return Boolean(ctx);
}

/** Returns false when the report is not accepted (caller answers 404). */
export async function reportEventStart(deps: EngineDeps, e: EventStart): Promise<boolean> {
  if (isWorkflowEventId(e.eventId)) {
    // The step knows its agent and books agent_runs itself. Not a webhook arrival,
    // so nothing goes into webhook_events.
    return onStepStarted(deps, e.eventId, e.agentId);
  }

  const { db } = deps;
  const owner = e.agentId ? await ownerOf(db, e.agentId) : null;
  if (e.agentId && !owner) return false;

  const [existing] = await db
    .select({ id: webhookEvents.id, ownerId: webhookEvents.ownerId })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, e.eventId))
    .limit(1);
  if (existing) {
    if (owner && existing.ownerId !== owner && existing.ownerId !== "unknown") return false;
    await db.update(webhookEvents).set({ status: "processing" }).where(eq(webhookEvents.id, e.eventId));
  } else {
    // Agent picked the job up before the webhook log row was written; the webhook
    // insert fills in the owner when it lands (onConflictDoUpdate in webhook.ts).
    await db
      .insert(webhookEvents)
      .values({
        id: e.eventId,
        brokerId: e.brokerId,
        ownerId: owner ?? "unknown",
        sourceType: e.sourceType ?? "unknown",
        eventType: e.eventType ?? null,
        status: "processing",
        routed: 1,
        createdAt: Date.now(),
      })
      .onConflictDoNothing();
  }
  if (e.agentId) await recordRunStart(db, e.agentId, e.eventId);
  return true;
}

/** Returns false when the report is not accepted (caller answers 404). */
export async function reportEventEnd(
  deps: EngineDeps,
  eventId: string,
  status: "processing" | "done" | "failed",
  result: ReportedResult | undefined,
  agentId?: string,
): Promise<boolean> {
  if (isWorkflowEventId(eventId)) {
    if (status === "processing") return true;
    return onStepFinished(deps, eventId, status, result ?? {}, agentId);
  }

  const { db } = deps;
  const owner = agentId ? await ownerOf(db, agentId) : null;
  if (agentId && (!owner || !(await eventBelongsTo(db, eventId, owner)))) return false;

  await db
    .update(webhookEvents)
    .set({ status })
    .where(
      owner
        ? and(eq(webhookEvents.id, eventId), or(eq(webhookEvents.ownerId, owner), eq(webhookEvents.ownerId, "unknown")))
        : eq(webhookEvents.id, eventId),
    );
  if (status === "processing") return true;

  if (agentId) await recordRunEnd(db, agentId, eventId, status, result ?? {});
  // ReplyInterceptor：任務結束 → 依 reply policy 執行 onSuccess/onFailure（fire-and-forget）
  runReply(db, eventId, result ?? { status: status === "done" ? "success" : "failed" }, deps.log);
  return true;
}
