// Shared handling for "an agent started / finished an event", behind both the
// legacy shared-token routes (/internal/events) and the per-agent routes
// (/internal/agents/:id/events). Workflow steps ("wf_" eventIds) go to the
// engine; everything else keeps the original webhook_events + reply-policy flow.
import { eq } from "drizzle-orm";
import { webhookEvents } from "../db/schema.js";
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
  agentId?: string; // known only on the per-agent route
}

export async function reportEventStart(deps: EngineDeps, e: EventStart): Promise<void> {
  if (isWorkflowEventId(e.eventId)) {
    // The step knows its agent; agent_runs is booked by the engine. Not a webhook arrival,
    // so nothing goes into webhook_events.
    await onStepStarted(deps, e.eventId);
    return;
  }

  const { db } = deps;
  const [existing] = await db.select({ id: webhookEvents.id }).from(webhookEvents).where(eq(webhookEvents.id, e.eventId)).limit(1);
  if (existing) {
    await db.update(webhookEvents).set({ status: "processing" }).where(eq(webhookEvents.id, e.eventId));
  } else {
    // Agent picked the job up before the webhook log row was written; the webhook
    // insert fills in the owner when it lands (onConflictDoUpdate in webhook.ts).
    await db
      .insert(webhookEvents)
      .values({
        id: e.eventId,
        brokerId: e.brokerId,
        ownerId: "unknown",
        sourceType: e.sourceType ?? "unknown",
        eventType: e.eventType ?? null,
        status: "processing",
        routed: 1,
        createdAt: Date.now(),
      })
      .onConflictDoNothing();
  }
  if (e.agentId) await recordRunStart(db, e.agentId, e.eventId);
}

export async function reportEventEnd(
  deps: EngineDeps,
  eventId: string,
  status: "processing" | "done" | "failed",
  result: ReportedResult | undefined,
  agentId?: string,
): Promise<void> {
  if (status === "processing") {
    if (!isWorkflowEventId(eventId))
      await deps.db.update(webhookEvents).set({ status }).where(eq(webhookEvents.id, eventId));
    return;
  }

  if (isWorkflowEventId(eventId)) {
    await onStepFinished(deps, eventId, status, result ?? {});
    return;
  }

  await deps.db.update(webhookEvents).set({ status }).where(eq(webhookEvents.id, eventId));
  if (agentId) await recordRunEnd(deps.db, agentId, eventId, status, result ?? {});
  // ReplyInterceptor：任務結束 → 依 reply policy 執行 onSuccess/onFailure（fire-and-forget）
  runReply(deps.db, eventId, result ?? { status: status === "done" ? "success" : "failed" }, deps.log);
}
