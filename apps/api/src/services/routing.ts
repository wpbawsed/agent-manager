import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { routingRules } from "../db/schema.js";
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
  queueId: string;
  eventTypes?: string[];           // allowlist of eventType strings; empty/omitted = catch-all
  conditions?: RoutingCondition[]; // payload-level filter; empty/omitted = pass-through
  replyTarget?: string;
  replyPolicy?: ReplyPolicy;       // onReceived/onSuccess/onFailure；未設 = 不自動回覆
  ownerId: string;
}

export async function createRoutingRule(db: DB, input: CreateRoutingRuleInput) {
  const id = randomUUID();
  const now = Date.now();

  const [rule] = await db
    .insert(routingRules)
    .values({
      id,
      ownerId: input.ownerId,
      name: input.name ?? null,
      brokerId: input.brokerId,
      queueId: input.queueId,
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
  },
) {
  const rule = await getRoutingRule(db, id, ownerId);
  if (!rule) return null;

  const updates: Record<string, unknown> = {};
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

