import type { FastifyInstance } from "fastify";
import { createQueue, listQueues, getQueue, deleteQueue } from "../services/queues.js";

export default async function queuesRoutes(app: FastifyInstance) {
  // POST /api/queues
  app.post<{ Body: { name: string; description?: string } }>(
    "/",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name:        { type: "string", minLength: 1 },
            description: { type: "string" },
          },
        },
      },
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const queue = await createQueue(app.db, { ...req.body, ownerId: user.sub });
      return reply.code(201).send(queue);
    },
  );

  // GET /api/queues
  app.get("/", { preHandler: [app.authenticate] }, async (req) => {
    const user = req.user as { sub: string };
    return listQueues(app.db, user.sub);
  });

  // GET /api/queues/:id
  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const queue = await getQueue(app.db, req.params.id, user.sub);
      if (!queue) return reply.code(404).send({ error: "Queue not found" });
      return queue;
    },
  );

  // DELETE /api/queues/:id
  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const ok = await deleteQueue(app.db, req.params.id, user.sub);
      if (!ok) return reply.code(404).send({ error: "Queue not found" });
      return reply.code(204).send();
    },
  );
}
