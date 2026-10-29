import type { FastifyInstance } from "fastify";
import {
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  getAgentIntegration,
} from "../services/agents.js";

export default async function agentsRoutes(app: FastifyInstance) {
  // POST /api/agents — Create agent
  // Response includes `integration` (push API endpoints, token, ready-to-run
  // source files). The manager never deploys or starts agents itself.
  app.post<{
    Body: {
      name: string;
      description?: string;
      instruction?: string;
      queueId?: string;
      type?: "local" | "cloud";
      endpoint?: string;
    };
  }>(
    "/",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name:        { type: "string", minLength: 1 },
            description: { type: "string" },
            instruction: { type: "string" },
            queueId:     { type: "string" },
            type:        { type: "string", enum: ["local", "cloud"] },
            endpoint:    { type: "string" },
          },
        },
      },
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const result = await createAgent(app.db, {
        ...req.body,
        ownerId: user.sub,
      });
      return reply.code(201).send({
        ...result.agent,
        integration: result.integration,
      });
    },
  );

  // GET /api/agents — List agents (each row carries computed `online`)
  app.get("/", { preHandler: [app.authenticate] }, async (req) => {
    const user = req.user as { sub: string };
    return listAgents(app.db, user.sub);
  });

  // GET /api/agents/:id — Get single agent
  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
      return agent;
    },
  );

  // GET /api/agents/:id/integration — Re-issue onboarding material
  app.get<{ Params: { id: string } }>(
    "/:id/integration",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const integration = await getAgentIntegration(app.db, req.params.id, user.sub);
      if (!integration) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      return integration;
    },
  );

  // PATCH /api/agents/:id — Update agent
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await updateAgent(
        app.db,
        req.params.id,
        user.sub,
        req.body as Parameters<typeof updateAgent>[3],
      );
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
      return agent;
    },
  );

  // DELETE /api/agents/:id — Delete agent
  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const ok = await deleteAgent(app.db, req.params.id, user.sub);
      if (!ok) return reply.code(404).send({ error: "Agent not found" });
      return reply.code(204).send();
    },
  );
}
