import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { brokers, queues, routingRules, workflows } from "../db/schema.js";
import type { DB } from "../db/client.js";
import type { ReplyPolicy } from "../lib/reply-policy.js";

export interface RoutingCondition {
  field: string;   // e.g. "projectKey", "status", "assignee", "eventType", "sourceType"
  op: "eq" | "neq" | "in" | "nin" | "contains" | "startsWith";
  value: string | string[];
}

export type { ReplyPolicy };

/** Policy 全空(三個 step 都沒設)視同未設定，存 null 而非空物件。 */
function isEmptyPolicy(p: ReplyPolicy): boolean {
  return !p.onReceived && !p.onSuccess && !p.onFailure;
}

export interface CreateRoutingRuleInput {
  name?: string;
  brokerId: string;
  queueId?: string;                // target: exactly one of queueId / workflowId
  workflowId?: string;
  eventTypes?: string[];           // allowlist of eventType strings; empty/omitted = catch-all
  conditions?: RoutingCondition[]; // payload-level filter; empty/omitted = pass-through
  replyTarget?: string;
  replyPolicy?: ReplyPolicy;       // onReceived/onSuccess/onFailure；未設 = 不自動回覆
  ownerId: string;
}

export class RoutingTargetError extends Error {}

/** A rule targets exactly one of: a queue (single agent) or a workflow — and it must be the caller's own. */
async function checkTarget(db: DB, ownerId: string, queueId?: string | null, workflowId?: string | null) {
  if (Boolean(queueId) === Boolean(workflowId)) throw new RoutingTargetError("Set exactly one of queueId or workflowId");
  if (queueId) {
    const [q] = await db
      .select({ id: queues.id })
      .from(queues)
      .where(and(eq(queues.id, queueId), eq(queues.ownerId, ownerId)))
      .limit(1);
    if (!q) throw new RoutingTargetError("Queue not found");
  }
  if (workflowId) {
    const [wf] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.ownerId, ownerId)))
      .limit(1);
    if (!wf) throw new RoutingTargetError("Workflow not found");
  }
}

export async function createRoutingRule(db: DB, input: CreateRoutingRuleInput) {
  const [broker] = await db
    .select({ id: brokers.id })
    .from(brokers)
    .where(and(eq(brokers.id, input.brokerId), eq(brokers.ownerId, input.ownerId)))
    .limit(1);
  if (!broker) throw new RoutingTargetError("Broker not found");
  await checkTarget(db, input.ownerId, input.queueId, input.workflowId);
  const id = randomUUID();
  const now = Date.now();

  const [rule] = await db
    .insert(routingRules)
    .values({
      id,
      ownerId: input.ownerId,
      name: input.name ?? null,
      brokerId: input.brokerId,
      queueId: input.queueId ?? null,
      workflowId: input.workflowId ?? null,
      eventTypes: input.eventTypes?.length ? JSON.stringify(input.eventTypes) : null,
      conditions: input.conditions?.length ? JSON.stringify(input.conditions) : null,
      replyTarget: input.replyTarget ?? null,
      replyPolicy:
        input.replyPolicy && !isEmptyPolicy(input.replyPolicy)
          ? JSON.stringify(input.replyPolicy)
          : null,
      createdAt: now,
    })
    .returning();

  return rule;
}

export async function listRoutingRules(db: DB, ownerId: string) {
  return db.select().from(routingRules).where(eq(routingRules.ownerId, ownerId));
}

export async function getRoutingRule(db: DB, id: string, ownerId: string) {
  const [rule] = await db
    .select()
    .from(routingRules)
    .where(eq(routingRules.id, id))
    .limit(1);
  if (!rule || rule.ownerId !== ownerId) return null;
  return rule;
}

export async function updateRoutingRule(
  db: DB,
  id: string,
  ownerId: string,
  patch: {
    name?: string | null;
    eventTypes?: string[] | null;
    conditions?: RoutingCondition[] | null;
    replyTarget?: string | null;
    replyPolicy?: ReplyPolicy | null;
    queueId?: string | null;
    workflowId?: string | null;
  },
) {
  const rule = await getRoutingRule(db, id, ownerId);
  if (!rule) return null;

  const updates: Record<string, unknown> = {};
  if (patch.queueId !== undefined || patch.workflowId !== undefined) {
    const queueId = patch.queueId !== undefined ? patch.queueId : rule.queueId;
    const workflowId = patch.workflowId !== undefined ? patch.workflowId : rule.workflowId;
    await checkTarget(db, ownerId, queueId, workflowId);
    updates.queueId = queueId || null;
    updates.workflowId = workflowId || null;
  }

  if (patch.name !== undefined) updates.name = patch.name ?? null;
  if (patch.eventTypes !== undefined) {
    updates.eventTypes = patch.eventTypes?.length ? JSON.stringify(patch.eventTypes) : null;
  }
  if (patch.conditions !== undefined) {
    updates.conditions = patch.conditions?.length ? JSON.stringify(patch.conditions) : null;
  }
  if (patch.replyTarget !== undefined) updates.replyTarget = patch.replyTarget ?? null;
  if (patch.replyPolicy !== undefined) {
    updates.replyPolicy =
      patch.replyPolicy && !isEmptyPolicy(patch.replyPolicy) ? JSON.stringify(patch.replyPolicy) : null;
  }

  const [updated] = await db
    .update(routingRules)
    .set(updates)
    .where(eq(routingRules.id, id))
    .returning();

  return updated;
}

export async function deleteRoutingRule(db: DB, id: string, ownerId: string) {
  const rule = await getRoutingRule(db, id, ownerId);
  if (!rule) return false;
  await db.delete(routingRules).where(eq(routingRules.id, id));
  return true;
}

