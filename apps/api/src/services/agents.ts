import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agents, queues } from "../db/schema.js";
import type { DB } from "../db/client.js";

// Agent CRUD
//
// Agent 進程不再由本平台 spawn/管理 —— 每個 agent 現在是獨立部署到 Railway 的
// agent-teammate app（見 personal-developer-agent/repos/agent-teammate/），從
// BullMQ 佇列消費任務、用 Claude Agent SDK headless 執行、透過 /internal API
// 回報 log/heartbeat/結果。這裡的 `agents` 表純粹是登記用（名稱、說明、
// instruction 備忘、綁定的 queue），不再驅動任何進程啟停。

export interface CreateAgentInput {
  name: string;
  description?: string;
  instruction?: string;
  queueId?: string;
  runtimeCmd?: string;
  ownerId: string;
}

export async function createAgent(db: DB, input: CreateAgentInput) {
  const id = randomUUID();
  const apiToken = randomUUID();
  const now = Date.now();

  if (input.queueId) {
    const [queue] = await db.select().from(queues).where(eq(queues.id, input.queueId)).limit(1);
    if (queue?.ownerId !== input.ownerId) throw new Error("Queue not found or access denied");
  }

  const [agent] = await db
    .insert(agents)
    .values({
      id,
      ownerId: input.ownerId,
      name: input.name,
      description: input.description,
      instruction: input.instruction,
      queueId: input.queueId ?? null,
      runtimeCmd: input.runtimeCmd ?? null,
      apiToken,
      status: "stopped",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return agent;
}

export async function listAgents(db: DB, ownerId: string) {
  return db.select().from(agents).where(eq(agents.ownerId, ownerId));
}

export async function getAgent(db: DB, id: string, ownerId: string) {
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent || agent.ownerId !== ownerId) return null;
  return agent;
}

export async function updateAgent(
  db: DB,
  id: string,
  ownerId: string,
  input: Partial<Omit<CreateAgentInput, "ownerId">>,
) {
  const agent = await getAgent(db, id, ownerId);
  if (!agent) return null;

  const updates: Record<string, unknown> = { updatedAt: Date.now() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.instruction !== undefined) updates.instruction = input.instruction;
  if (input.queueId !== undefined) updates.queueId = input.queueId;
  if (input.runtimeCmd !== undefined) updates.runtimeCmd = input.runtimeCmd;

  const [updated] = await db.update(agents).set(updates).where(eq(agents.id, id)).returning();
  return updated;
}

export async function deleteAgent(db: DB, id: string, ownerId: string) {
  const agent = await getAgent(db, id, ownerId);
  if (!agent) return false;
  await db.delete(agents).where(eq(agents.id, id));
  return true;
}
