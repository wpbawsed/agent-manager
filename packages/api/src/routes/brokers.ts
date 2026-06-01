import type { FastifyInstance } from "fastify";
import {
  createBroker,
  listBrokers,
  getBroker,
  updateBroker,
  updateBrokerStatus,
  deleteBroker,
} from "../services/brokers.js";

export default async function brokersRoutes(app: FastifyInstance) {
  // POST /api/brokers
  app.post<{
    Body: {
      name: string;
      type: "slack" | "jira" | "github" | "line" | "railway" | "notion";
      config: Record<string, unknown>;
      requiredVars?: Array<{
        key: string;
        label: string;
        placeholder?: string;
        secret: boolean;
        value: string;
      }>;
    };
  }>(
    "/",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "type", "config"],
          properties: {
            name: { type: "string", minLength: 1 },
      type: { type: "string", enum: ["slack", "jira", "github", "line", "railway", "notion"] },
            config: { type: "object" },
            requiredVars: { type: "array" },
          },
        },
      },
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const broker = await createBroker(app.db, {
        ...req.body,
        ownerId: user.sub,
      });
      return reply.code(201).send(broker);
    },
  );

  // GET /api/brokers
  app.get("/", { preHandler: [app.authenticate] }, async (req) => {
    const user = req.user as { sub: string };
    return listBrokers(app.db, user.sub);
  });

  // GET /api/brokers/:id
  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const broker = await getBroker(app.db, req.params.id, user.sub);
      if (!broker) return reply.code(404).send({ error: "Broker not found" });
      return broker;
    },
  );

  // POST /api/brokers/:id/activate
  app.post<{ Params: { id: string } }>(
    "/:id/activate",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const broker = await updateBrokerStatus(
        app.db,
        req.params.id,
        user.sub,
        "active",
      );
      if (!broker) return reply.code(404).send({ error: "Broker not found" });
      return broker;
    },
  );

  // POST /api/brokers/:id/deactivate
  app.post<{ Params: { id: string } }>(
    "/:id/deactivate",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const broker = await updateBrokerStatus(
        app.db,
        req.params.id,
        user.sub,
        "inactive",
      );
      if (!broker) return reply.code(404).send({ error: "Broker not found" });
      return broker;
    },
  );

  // PATCH /api/brokers/:id
  app.patch<{
    Params: { id: string };
    Body: { name?: string; config?: Record<string, unknown> };
  }>(
    "/:id",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1 },
            config: { type: "object" },
          },
        },
      },
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const broker = await updateBroker(
        app.db,
        req.params.id,
        user.sub,
        req.body,
      );
      if (!broker) return reply.code(404).send({ error: "Broker not found" });
      return broker;
    },
  );

  // DELETE /api/brokers/:id
  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const ok = await deleteBroker(app.db, req.params.id, user.sub);
      if (!ok) return reply.code(404).send({ error: "Broker not found" });
      return reply.code(204).send();
    },
  );
}
