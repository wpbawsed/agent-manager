import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agents, queues } from "../db/schema.js";
import type { DB } from "../db/client.js";
import { buildLocalIntegration, type Integration } from "./agent-template.js";

// The manager never starts or stops agents: every agent (local or cloud) runs
// its own runtime and self-reports via the /internal/agents/:id/* push APIs.
// `type` only records where it runs.
const MANAGER_PUBLIC_URL =
  process.env.MANAGER_PUBLIC_URL || process.env.API_SERVER_URL || "http://localhost:8080";

// An agent is "online" if it pushed a heartbeat within this window.
const HEARTBEAT_TTL_MS = Number(process.env.HEARTBEAT_TTL_MS) || 90_000;

export type AgentRow = typeof agents.$inferSelect;
export type AgentView = AgentRow & { online: boolean };

export function withOnline(agent: AgentRow): AgentView {
  return {
    ...agent,
    online:
      agent.lastHeartbeatAt != null &&
      Date.now() - agent.lastHeartbeatAt < HEARTBEAT_TTL_MS,
  };
}

// Queue names are only revealed for queues owned by the requesting user.
async function resolveOwnedQueueName(
  db: DB,
  queueId: string | null,
  ownerId: string,
): Promise<string | null> {
  if (!queueId) return null;
  const [queue] = await db.select().from(queues).where(eq(queues.id, queueId)).limit(1);
  if (!queue || queue.ownerId !== ownerId) return null;
  return queue.name;
}

// ── Agent CRUD ──────────────────────────────────────────────────────────────

export interface CreateAgentInput {
  name: string;
  description?: string;
  instruction?: string;
  queueId?: string;
  type?: "local" | "cloud";
  endpoint?: string;
  ownerId: string;
}

export interface CreateAgentResult {
  agent: AgentView;
  integration: Integration; // onboarding material: env, push endpoints, sample runner
}

export async function createAgent(db: DB, input: CreateAgentInput): Promise<CreateAgentResult> {
  const id = randomUUID();
  const apiToken = randomUUID();
  const now = Date.now();
  const type = input.type === "cloud" ? "cloud" : "local";

  let queueName: string | null = null;
  if (input.queueId) {
    const [queue] = await db.select().from(queues).where(eq(queues.id, input.queueId)).limit(1);
    if (queue?.ownerId !== input.ownerId) throw new Error("Queue not found or access denied");
    queueName = queue.name;
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
      type,
      endpoint: input.endpoint ?? null,
      apiToken,
      status: "stopped",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const integration = buildLocalIntegration({
    agentId: id,
    agentName: input.name,
    apiToken,
    managerUrl: MANAGER_PUBLIC_URL,
    queueName,
    instruction: input.instruction,
  });
  return { agent: withOnline(agent), integration };
}

export async function listAgents(db: DB, ownerId: string): Promise<AgentView[]> {
  const rows = await db.select().from(agents).where(eq(agents.ownerId, ownerId));
  return rows.map(withOnline);
}

export async function getAgent(db: DB, id: string, ownerId: string): Promise<AgentView | null> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent || agent.ownerId !== ownerId) return null;
  return withOnline(agent);
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
  if (input.queueId !== undefined) {
    if (input.queueId) {
      const owned = await resolveOwnedQueueName(db, input.queueId, ownerId);
      if (owned === null) throw new Error("Queue not found or access denied");
    }
    updates.queueId = input.queueId || null;
  }
  if (input.endpoint !== undefined) updates.endpoint = input.endpoint;

  const [updated] = await db.update(agents).set(updates).where(eq(agents.id, id)).returning();
  return withOnline(updated);
}

export async function deleteAgent(db: DB, id: string, ownerId: string) {
  const agent = await getAgent(db, id, ownerId);
  if (!agent) return false;
  await db.delete(agents).where(eq(agents.id, id));
  return true;
}

// Re-issue the integration material for an existing agent.
export async function getAgentIntegration(db: DB, id: string, ownerId: string) {
  const agent = await getAgent(db, id, ownerId);
  if (!agent) return null;
  const queueName = await resolveOwnedQueueName(db, agent.queueId, ownerId);

  return buildLocalIntegration({
    agentId: agent.id,
    agentName: agent.name,
    apiToken: agent.apiToken,
    managerUrl: MANAGER_PUBLIC_URL,
    queueName,
    instruction: agent.instruction,
  });
}
