import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agents, agentLogs, agentMetrics } from "../db/schema.js";

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "";

// Simple in-memory rate limit: per agent per minute across all push routes.
// (heartbeat 2/min + metrics 1/min + logs 12/min leaves plenty of headroom)
const RATE_LIMIT_PER_MIN = Number(process.env.PUSH_RATE_LIMIT_PER_MIN) || 120;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

// Drop expired buckets so deleted agents don't accumulate entries forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(key);
  }
}, 300_000).unref();

function rateLimited(agentId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(agentId);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(agentId, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_PER_MIN;
}

// Push APIs implemented by every agent (local or cloud).
// Auth: Bearer {agent.apiToken} — each agent can only report about itself.
// INTERNAL_TOKEN is also accepted so trusted infra (sandbox-worker) can proxy.
//
//   POST /internal/agents/:id/heartbeat   ← alive + uptime
//   POST /internal/agents/:id/metrics     ← cpu / mem / counters
//   POST /internal/agents/:id/logs        ← batch of log lines
const agentPushRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req, reply) => {
    const { id } = req.params as { id: string };
    const auth = (req.headers["authorization"] ?? "") as string;
    const match = /^Bearer\s+(\S+)$/.exec(auth);
    const token = match?.[1] ?? "";
    if (!token) return reply.code(401).send({ error: "Unauthorized" });

    const [agent] = await app.db
      .select({ id: agents.id, ownerId: agents.ownerId, apiToken: agents.apiToken })
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1);

    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    if (token !== agent.apiToken && (!INTERNAL_TOKEN || token !== INTERNAL_TOKEN)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (rateLimited(id)) {
      return reply.code(429).send({ error: "Rate limit exceeded" });
    }
    (req as { agentOwnerId?: string }).agentOwnerId = agent.ownerId;
  });

  // POST /internal/agents/:id/heartbeat
  app.post<{
    Params: { id: string };
    Body: { status?: string; uptimeSeconds?: number };
  }>(
    "/:id/heartbeat",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["running", "idle", "error"] },
            uptimeSeconds: { type: "number" },
          },
        },
      },
    },
    async (req) => {
      const { id } = req.params;
      const status = req.body?.status === "error" ? "error" : "running";
      await app.db
        .update(agents)
        .set({ status, lastHeartbeatAt: Date.now(), updatedAt: Date.now() })
        .where(eq(agents.id, id));
      return { ok: true };
    },
  );

  // POST /internal/agents/:id/metrics
  app.post<{
    Params: { id: string };
    Body: {
      cpuPercent?: number;
      memoryMb?: number;
      uptimeSeconds?: number;
      processedCount?: number;
      errorCount?: number;
    };
  }>(
    "/:id/metrics",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            cpuPercent: { type: "number" },
            memoryMb: { type: "number" },
            uptimeSeconds: { type: "number" },
            processedCount: { type: "number" },
            errorCount: { type: "number" },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const ownerId = (req as { agentOwnerId?: string }).agentOwnerId ?? "unknown";
      const b = req.body ?? {};
      await app.db.insert(agentMetrics).values({
        id: randomUUID(),
        agentId: id,
        ownerId,
        cpuPercent: b.cpuPercent != null ? Math.round(b.cpuPercent) : null,
        memoryMb: b.memoryMb != null ? Math.round(b.memoryMb) : null,
        uptimeSeconds: b.uptimeSeconds != null ? Math.round(b.uptimeSeconds) : null,
        processedCount: b.processedCount ?? null,
        errorCount: b.errorCount ?? null,
        createdAt: Date.now(),
      });
      // Metrics push also counts as a heartbeat
      await app.db
        .update(agents)
        .set({ lastHeartbeatAt: Date.now(), updatedAt: Date.now() })
        .where(eq(agents.id, id));
      return reply.code(201).send({ ok: true });
    },
  );

  // POST /internal/agents/:id/logs — batch
  app.post<{
    Params: { id: string };
    Body: {
      logs: Array<{ level?: string; message: string; sessionId?: string }>;
    };
  }>(
    "/:id/logs",
    {
      schema: {
        body: {
          type: "object",
          required: ["logs"],
          properties: {
            logs: {
              type: "array",
              maxItems: 100,
              items: {
                type: "object",
                required: ["message"],
                properties: {
                  level: { type: "string", enum: ["info", "error"] },
                  message: { type: "string", maxLength: 10000 },
                  sessionId: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const ownerId = (req as { agentOwnerId?: string }).agentOwnerId ?? "unknown";
      const now = Date.now();
      const rows = req.body.logs.map((l, i) => ({
        id: randomUUID(),
        agentId: id,
        ownerId,
        sessionId: l.sessionId ?? null,
        level: l.level === "error" ? "error" : "info",
        message: l.message,
        createdAt: now + i, // preserve ordering within the batch
      }));
      if (rows.length) await app.db.insert(agentLogs).values(rows);
      await app.db
        .update(agents)
        .set({ lastHeartbeatAt: Date.now() })
        .where(eq(agents.id, id));
      return reply.code(201).send({ ok: true, count: rows.length });
    },
  );
};

export default agentPushRoutes;
