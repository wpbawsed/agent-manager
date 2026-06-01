import type { FastifyInstance } from "fastify";
import { eq, and, desc } from "drizzle-orm";
import { agentLogs, webhookEvents } from "../db/schema.js";

export default async function logsRoutes(app: FastifyInstance) {
  // GET /api/logs?agentId=xxx&limit=100
  app.get<{ Querystring: { agentId?: string; limit?: string } }>(
    "/",
    { preHandler: [app.authenticate] },
    async (req) => {
      const user = req.user as { sub: string };
      const limit = Math.min(Number(req.query.limit) || 100, 500);

      const query = app.db
        .select()
        .from(agentLogs)
        .where(
          and(
            eq(agentLogs.ownerId, user.sub),
            req.query.agentId
              ? eq(agentLogs.agentId, req.query.agentId)
              : undefined,
          ),
        )
        .orderBy(desc(agentLogs.createdAt))
        .limit(limit);

      return query;
    },
  );

  // GET /api/logs/webhooks?brokerId=xxx&status=queued&limit=100
  app.get<{ Querystring: { brokerId?: string; status?: string; limit?: string } }>(
    "/webhooks",
    { preHandler: [app.authenticate] },
    async (req) => {
      const user = req.user as { sub: string };
      const limit = Math.min(Number(req.query.limit) || 100, 500);

      const rows = await app.db
        .select()
        .from(webhookEvents)
        .where(
          and(
            eq(webhookEvents.ownerId, user.sub),
            req.query.brokerId ? eq(webhookEvents.brokerId, req.query.brokerId) : undefined,
            req.query.status   ? eq(webhookEvents.status, req.query.status)     : undefined,
          ),
        )
        .orderBy(desc(webhookEvents.createdAt))
        .limit(limit);

      return rows;
    },
  );
}
