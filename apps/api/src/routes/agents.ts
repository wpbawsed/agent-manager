import type { FastifyInstance } from "fastify";
import {
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  startAgent,
  stopAgent,
  getAgentIntegration,
} from "../services/agents.js";

export default async function agentsRoutes(app: FastifyInstance) {
  // POST /api/agents — Create agent
  // type=local → response includes `integration` (push API endpoints, token,
  //              ready-to-run source files for the user's machine)
  // type=cloud → response includes `deploy` (Cloudflare Sandbox init result)
  app.post<{
    Body: {
      name: string;
      description?: string;
      instruction?: string;
      queueId?: string;
      runtimeCmd?: string;
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
            runtimeCmd:  { type: "string" },
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
        deploy: result.deploy,
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

  // GET /api/agents/:id/integration — Re-issue onboarding material (local only)
  app.get<{ Params: { id: string } }>(
    "/:id/integration",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const integration = await getAgentIntegration(app.db, req.params.id, user.sub);
      if (!integration) {
        return reply
          .code(404)
          .send({ error: "Agent not found or not a local agent" });
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

  // POST /api/agents/:id/start — Deploy/start a cloud agent (400 for local)
  app.post<{ Params: { id: string } }>(
    "/:id/start",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const result = await startAgent(app.db, req.params.id, user.sub);
      if (!result.ok) return reply.code(400).send({ error: result.error });
      return result;
    },
  );

  // POST /api/agents/:id/stop — Stop a cloud agent (400 for local)
  app.post<{ Params: { id: string } }>(
    "/:id/stop",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const result = await stopAgent(app.db, req.params.id, user.sub);
      if (!result.ok) return reply.code(400).send({ error: result.error });
      return result;
    },
  );
}
