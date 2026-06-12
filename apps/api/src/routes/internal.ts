import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agents, agentLogs, webhookEvents } from "../db/schema.js";

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "";

const internalRoutes: FastifyPluginAsync = async (app) => {
  // Verify internal token (shared secret between Node Agent and API Server)
  app.addHook("preHandler", async (req, reply) => {
    const auth = req.headers["authorization"] ?? "";
    const token = auth.replace("Bearer ", "").trim();
    if (!token || token !== INTERNAL_TOKEN) {
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
  // Called by BullMQConsumer when it picks up a job to record processing state.
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
      const { eventId, brokerId, sourceType = "unknown", eventType } = req.body;

      const [existing] = await app.db
        .select({ id: webhookEvents.id })
        .from(webhookEvents)
        .where(eq(webhookEvents.id, eventId))
        .limit(1);

      if (existing) {
        await app.db
          .update(webhookEvents)
          .set({ status: "processing" })
          .where(eq(webhookEvents.id, eventId));
      } else {
        // Consumer received an event that was enqueued before webhook logging — create record
        await app.db.insert(webhookEvents).values({
          id: eventId,
          brokerId,
          ownerId: "unknown",
          sourceType,
          eventType: eventType ?? null,
          status: "processing",
          routed: 1,
          createdAt: Date.now(),
        });
      }

      return reply.code(200).send({ ok: true });
    },
  );

  // PATCH /internal/events/:eventId
  // Called by BullMQConsumer when a job completes or fails.
  app.patch<{
    Params: { eventId: string };
    Body: { status: "processing" | "done" | "failed" };
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
          },
        },
      },
    },
    async (req, reply) => {
      const { eventId } = req.params;
      const { status } = req.body;

      await app.db
        .update(webhookEvents)
        .set({ status })
        .where(eq(webhookEvents.id, eventId));

      return reply.code(200).send({ ok: true });
    },
  );
};

export default internalRoutes;
