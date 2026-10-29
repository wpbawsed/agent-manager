import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agents, agentLogs } from "../db/schema.js";
import { reportEventEnd, reportEventStart } from "../lib/event-report.js";
import { engineDeps } from "../workflow/deps.js";
import type { ReportedResult } from "../workflow/engine.js";

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "";
// Layer B（agent-teammate）用 AGENT_API_TOKEN 回報；接受它或既有 INTERNAL_TOKEN
const AGENT_API_TOKEN = process.env.AGENT_API_TOKEN || "";

const internalRoutes: FastifyPluginAsync = async (app) => {
  // Verify internal token (shared secret between agents and API Server)
  app.addHook("preHandler", async (req, reply) => {
    const auth = req.headers["authorization"] ?? "";
    const token = auth.replace("Bearer ", "").trim();
    const ok =
      (INTERNAL_TOKEN && token === INTERNAL_TOKEN) ||
      (AGENT_API_TOKEN && token === AGENT_API_TOKEN);
    if (!ok) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  // POST /internal/agent-log
  // Called by agent process to write logs to DB
  app.post<{
    Body: {
      agentId: string;
      level?: string;
      message: string;
      metadata?: unknown;
    };
  }>(
    "/agent-log",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId", "message"],
          properties: {
            agentId: { type: "string" },
            level: { type: "string", default: "info" },
            message: { type: "string" },
            metadata: { type: "object" },
          },
        },
      },
    },
    async (req, reply) => {
      const { agentId, level = "info", message, metadata } = req.body;

      const [agent] = await app.db
        .select({ ownerId: agents.ownerId })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      await app.db.insert(agentLogs).values({
        id: randomUUID(),
        agentId,
        ownerId: agent.ownerId,
        level,
        message,
        createdAt: Date.now(),
      });

      return reply.code(201).send({ ok: true });
    },
  );

  // POST /internal/agent-heartbeat
  // Called by BullMQConsumer (and other SDK consumers) every 30s to report liveness.
  app.post<{
    Body: {
      agent_id: string;
      status: string;
      processed_count: number;
      error_count: number;
      active_jobs?: number;
      uptime_seconds?: number;
      tenant_id?: string;
    };
  }>(
    "/agent-heartbeat",
    {
      schema: {
        body: {
          type: "object",
          required: ["agent_id"],
          properties: {
            agent_id: { type: "string" },
            status: { type: "string" },
            processed_count: { type: "number" },
            error_count: { type: "number" },
            active_jobs: { type: "number" },
            uptime_seconds: { type: "number" },
            tenant_id: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const { agent_id } = req.body;
      const [agent] = await app.db
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.id, agent_id))
        .limit(1);

      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      await app.db
        .update(agents)
        .set({ status: "running", lastHeartbeatAt: Date.now(), updatedAt: Date.now() })
        .where(eq(agents.id, agent_id));

      return reply.code(200).send({ ok: true });
    },
  );

  // POST /internal/events
  // Called by an agent when it picks up a job (legacy shared-token route; the
  // per-agent equivalent is POST /internal/agents/:id/events).
  app.post<{
    Body: {
      eventId: string;
      brokerId: string;
      sourceType: string;
      eventType?: string;
    };
  }>(
    "/events",
    {
      schema: {
        body: {
          type: "object",
          required: ["eventId", "brokerId"],
          properties: {
            eventId: { type: "string" },
            brokerId: { type: "string" },
            sourceType: { type: "string" },
            eventType: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      await reportEventStart(engineDeps(app, req.log), req.body);
      return reply.code(200).send({ ok: true });
    },
  );

  // PATCH /internal/events/:eventId
  // Called by an agent when a job completes or fails. "wf_" ids drive the workflow engine.
  app.patch<{
    Params: { eventId: string };
    Body: { status: "processing" | "done" | "failed"; result?: ReportedResult };
  }>(
    "/events/:eventId",
    {
      schema: {
        params: {
          type: "object",
          required: ["eventId"],
          properties: { eventId: { type: "string" } },
        },
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
      const { status, result } = req.body;
      await reportEventEnd(engineDeps(app, req.log), req.params.eventId, status, result);
      return reply.code(200).send({ ok: true });
    },
  );
};

export default internalRoutes;
