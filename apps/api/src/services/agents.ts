import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agents, queues } from "../db/schema.js";
import type { DB } from "../db/client.js";
import { buildLocalIntegration, type Integration } from "./agent-template.js";

// Cloud agents are deployed through the sandbox-worker (Cloudflare Worker +
// Sandbox Durable Object). Local agents are never touched by the manager —
// they self-report via the /internal/agents/:id/* push APIs.
const SANDBOX_WORKER_URL = process.env.SANDBOX_WORKER_URL || "";
const SANDBOX_INTERNAL_TOKEN = process.env.SANDBOX_INTERNAL_TOKEN || "";
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

// ── sandbox-worker client (cloud agents only) ──────────────────────────────

async function sandboxCall(
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  if (!SANDBOX_WORKER_URL) {
    return { ok: false, status: 0, error: "SANDBOX_WORKER_URL not configured" };
  }
  try {
    const res = await fetch(`${SANDBOX_WORKER_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SANDBOX_INTERNAL_TOKEN}`,
      },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => undefined);
    if (!res.ok) {
      return { ok: false, status: res.status, data, error: `sandbox-worker ${res.status}` };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }
}

function cloudAgentEnv(agent: AgentRow, queueName: string): Record<string, string> {
  return {
    AGENT_ID: agent.id,
    AGENT_TOKEN: agent.apiToken,
    AGENT_MANAGER_URL: MANAGER_PUBLIC_URL,
    QUEUE_NAME: queueName,
    REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
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
  runtimeCmd?: string;
  type?: "local" | "cloud";
  endpoint?: string;
  ownerId: string;
}

export interface CreateAgentResult {
  agent: AgentView;
  integration: Integration | null; // local agents get onboarding material
  deploy: { ok: boolean; error?: string } | null; // cloud agents get deploy result
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
      runtimeCmd: input.runtimeCmd ?? null,
      type,
      endpoint: input.endpoint ?? null,
      apiToken,
      status: "stopped",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (type === "local") {
    const integration = buildLocalIntegration({
      agentId: id,
      agentName: input.name,
      apiToken,
      managerUrl: MANAGER_PUBLIC_URL,
      queueName,
      instruction: input.instruction,
    });
    return { agent: withOnline(agent), integration, deploy: null };
  }

  // type === "cloud": initialize the sandbox (best-effort; agent record exists
  // either way and can be re-deployed via POST /api/agents/:id/start).
  const init = await sandboxCall(`/agents/${id}/init`, {
    instruction: input.instruction ?? `# ${input.name}\n`,
    env: cloudAgentEnv(agent, queueName ?? `broker-${id}`),
  });
  if (!init.ok) {
    console.error(`Cloud agent ${id} sandbox init failed:`, init.error, init.data ?? "");
  }
  return {
    agent: withOnline(agent),
    integration: null,
    deploy: init.ok ? { ok: true } : { ok: false, error: init.error },
  };
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
  if (input.runtimeCmd !== undefined) updates.runtimeCmd = input.runtimeCmd;
  if (input.endpoint !== undefined) updates.endpoint = input.endpoint;

  const [updated] = await db.update(agents).set(updates).where(eq(agents.id, id)).returning();
  return withOnline(updated);
}

export async function deleteAgent(db: DB, id: string, ownerId: string) {
  const agent = await getAgent(db, id, ownerId);
  if (!agent) return false;
  if (agent.type === "cloud") {
    await sandboxCall(`/agents/${id}/stop`); // best-effort teardown
  }
  await db.delete(agents).where(eq(agents.id, id));
  return true;
}

// ── Agent lifecycle ─────────────────────────────────────────────────────────
// Only cloud agents can be started/stopped by the manager. Local agents are
// managed by their own runtime; the manager just observes their heartbeats.

export async function startAgent(db: DB, id: string, ownerId: string) {
  const agent = await getAgent(db, id, ownerId);
  if (!agent) return { ok: false, error: "Agent not found" };

  if (agent.type === "local") {
    return {
      ok: false,
      error:
        "Local agents are started by their own runtime. Run the agent on your machine — it will report in via the push APIs.",
    };
  }

  const queueName = (await resolveOwnedQueueName(db, agent.queueId, ownerId)) ?? `broker-${id}`;

  const res = await sandboxCall(`/agents/${id}/start`, {
    cmd: agent.runtimeCmd ?? undefined,
    env: cloudAgentEnv(agent, queueName),
    instruction: agent.instruction ?? undefined,
  });
  if (!res.ok) return { ok: false, error: res.error ?? "Sandbox start failed" };

  await db.update(agents).set({ status: "running", updatedAt: Date.now() }).where(eq(agents.id, id));
  return { ok: true };
}

export async function stopAgent(db: DB, id: string, ownerId: string) {
  const agent = await getAgent(db, id, ownerId);
  if (!agent) return { ok: false, error: "Agent not found" };

  if (agent.type === "local") {
    return {
      ok: false,
      error: "Local agents are stopped from their own machine, not from the manager.",
    };
  }

  const res = await sandboxCall(`/agents/${id}/stop`);
  if (!res.ok && res.status !== 404) {
    return { ok: false, error: res.error ?? "Sandbox stop failed" };
  }

  await db.update(agents).set({ status: "stopped", updatedAt: Date.now() }).where(eq(agents.id, id));
  return { ok: true };
}

// Re-issue the integration material for an existing local agent.
export async function getAgentIntegration(db: DB, id: string, ownerId: string) {
  const agent = await getAgent(db, id, ownerId);
  if (!agent) return null;
  if (agent.type !== "local") return null;

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
