import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { routingRules } from "../db/schema.js";
import type { DB } from "../db/client.js";

export interface CreateRoutingRuleInput {
  name?: string;
  brokerId: string;
  queueId: string;
  eventTypes?: string[];   // allowlist of eventType strings; empty/omitted = catch-all
  replyTarget?: string;
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
      replyTarget: input.replyTarget ?? null,
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
  patch: { name?: string | null; eventTypes?: string[] | null; replyTarget?: string | null },
) {
  const rule = await getRoutingRule(db, id, ownerId);
  if (!rule) return null;

  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name ?? null;
  if (patch.eventTypes !== undefined) {
    updates.eventTypes = patch.eventTypes?.length ? JSON.stringify(patch.eventTypes) : null;
  }
  if (patch.replyTarget !== undefined) updates.replyTarget = patch.replyTarget ?? null;

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

