import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agents, agentLogs, agentMetrics } from "../db/schema.js";
import { reportEventEnd, reportEventStart } from "../lib/event-report.js";
import { engineDeps } from "../workflow/deps.js";
import { claimAttended, releaseAttended, type ReportedResult } from "../workflow/engine.js";
import { agentWork } from "../services/agent-stats.js";

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
// INTERNAL_TOKEN is also accepted so trusted infra can report on an agent's behalf.
// NOTE: INTERNAL_TOKEN is a single shared secret valid for ANY agent id (it is
// not scoped per-agent). Treat it like a server credential — never expose it
// to end users or client-side code.
//
//   POST /internal/agents/:id/heartbeat   ← alive + uptime
//   POST /internal/agents/:id/metrics     ← cpu / mem / counters
//   POST /internal/agents/:id/logs        ← batch of log lines
//   POST /internal/agents/:id/events      ← picked up a job (books agent_runs)
//   PATCH /internal/agents/:id/events/:eventId ← finished a job (reply policy / workflow engine)
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
    (req as { viaInternalToken?: boolean }).viaInternalToken = token !== agent.apiToken;
  });

  // POST /internal/agents/:id/heartbeat
  app.post<{
    Params: { id: string };
    Body: { status?: string; uptimeSeconds?: number; brainCommit?: string; brainPullError?: string | null };
  }>(
    "/:id/heartbeat",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["running", "idle", "error"] },
            uptimeSeconds: { type: "number" },
            brainCommit: { type: "string", maxLength: 64 },
            brainPullError: { type: ["string", "null"], maxLength: 2000 },
          },
        },
      },
    },
    async (req) => {
      const { id } = req.params;
      const b = req.body ?? {};
      // running = a Run in progress, idle = waiting for work, error = can't take work (e.g. usage limit).
      // Older agents send no status: treat as running, as before.
      const status = b.status === "error" || b.status === "idle" ? b.status : "running";
      await app.db
        .update(agents)
        .set({
          status,
          lastHeartbeatAt: Date.now(),
          updatedAt: Date.now(),
          // Only agents that know about brains send these; don't wipe them for the rest.
          ...(b.brainCommit !== undefined ? { brainCommit: b.brainCommit } : {}),
          ...(b.brainPullError !== undefined ? { brainPullError: b.brainPullError || null } : {}),
        })
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
      const ownerId = (req as { agentOwnerId?: string }).agentOwnerId;
      if (!ownerId) return reply.code(500).send({ error: "Owner resolution failed" });
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
      const ownerId = (req as { agentOwnerId?: string }).agentOwnerId;
      if (!ownerId) return reply.code(500).send({ error: "Owner resolution failed" });
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

  // GET /internal/agents/:id/work — queue depth, recent runs, runs waiting on a human here
  app.get<{ Params: { id: string } }>("/:id/work", async (req) => {
    const ownerId = (req as { agentOwnerId?: string }).agentOwnerId!;
    return agentWork(app, req.params.id, ownerId);
  });

  // POST /internal/agents/:id/events — this agent picked up a job.
  // Same as POST /internal/events, but the agent is known from its token, so agent_runs gets booked.
  app.post<{
    Params: { id: string };
    Body: { eventId: string; brokerId: string; sourceType?: string; eventType?: string };
  }>(
    "/:id/events",
    {
      schema: {
        body: {
          type: "object",
          required: ["eventId", "brokerId"],
          properties: {
            eventId: { type: "string", minLength: 1 },
            brokerId: { type: "string" },
            sourceType: { type: "string" },
            eventType: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const ok = await reportEventStart(engineDeps(app, req.log), { ...req.body, agentId: req.params.id });
      if (!ok) return reply.code(404).send({ error: "Event not found for this agent" });
      return { ok: true };
    },
  );

  // PATCH /internal/agents/:id/events/:eventId — this agent finished (or failed) a job.
  app.patch<{
    Params: { id: string; eventId: string };
    Body: { status: "processing" | "done" | "failed"; result?: ReportedResult };
  }>(
    "/:id/events/:eventId",
    {
      schema: {
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["processing", "done", "failed"] },
            result: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (req, reply) => {
      const ok = await reportEventEnd(engineDeps(app, req.log), req.params.eventId, req.body.status, req.body.result, req.params.id);
      if (!ok) return reply.code(404).send({ error: "Event not found for this agent" });
      return { ok: true };
    },
  );

  // §4.5 approval path: the agent's own UI continues a blocked node with a human present.
  // claim → run back to running + a kind=resume step; the result then comes in on that step's
  // eventId via PATCH /:id/events/:eventId. release → the attended run was abandoned.
  // Only the agent's own token: this says "a person approved this", which the shared token can't.
  app.post<{ Params: { id: string; runId: string }; Body: { node: string } }>(
    "/:id/workflow-runs/:runId/claim",
    { schema: { body: { type: "object", required: ["node"], properties: { node: { type: "string", minLength: 1 } } } } },
    async (req, reply) => {
      if ((req as { viaInternalToken?: boolean }).viaInternalToken) return reply.code(403).send({ error: "Use the agent's own token" });
      const r = await claimAttended(engineDeps(app, req.log), req.params.runId, req.params.id, req.body.node);
      if ("error" in r) return reply.code(r.notFound ? 404 : 409).send({ error: r.error });
      return r;
    },
  );

  app.post<{ Params: { id: string; eventId: string } }>("/:id/events/:eventId/release", async (req, reply) => {
    if ((req as { viaInternalToken?: boolean }).viaInternalToken) return reply.code(403).send({ error: "Use the agent's own token" });
    const err = await releaseAttended(engineDeps(app, req.log), req.params.eventId, req.params.id);
    if (err) return reply.code(409).send({ error: err });
    return { ok: true };
  });
};

export default agentPushRoutes;
