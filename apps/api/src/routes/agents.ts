import type { FastifyInstance } from "fastify";
import {
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
} from "../services/agents.js";

export default async function agentsRoutes(app: FastifyInstance) {
  // POST /api/agents — Create agent
  app.post<{
    Body: {
      name: string;
      description?: string;
      instruction?: string;
      queueId?: string;
      runtimeCmd?: string;
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
          },
        },
      },
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await createAgent(app.db, {
        ...req.body,
        ownerId: user.sub,
      });
      return reply.code(201).send(agent);
    },
  );

  // GET /api/agents — List agents
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
