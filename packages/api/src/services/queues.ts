import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { queues } from "../db/schema.js";
import type { DB } from "../db/client.js";

export interface CreateQueueInput {
  name: string;
  description?: string;
  ownerId: string;
}

export async function createQueue(db: DB, input: CreateQueueInput) {
  const id = randomUUID();
  const now = Date.now();

  const [queue] = await db
    .insert(queues)
    .values({
      id,
      ownerId: input.ownerId,
      name: input.name,
      description: input.description ?? null,
      createdAt: now,
    })
    .returning();

  return queue;
}

export async function listQueues(db: DB, ownerId: string) {
  return db.select().from(queues).where(eq(queues.ownerId, ownerId));
}

export async function getQueue(db: DB, id: string, ownerId: string) {
  const [queue] = await db.select().from(queues).where(eq(queues.id, id)).limit(1);
  if (!queue || queue.ownerId !== ownerId) return null;
  return queue;
}

export async function deleteQueue(db: DB, id: string, ownerId: string) {
  const queue = await getQueue(db, id, ownerId);
  if (!queue) return false;
  await db.delete(queues).where(eq(queues.id, id));
  return true;
}
