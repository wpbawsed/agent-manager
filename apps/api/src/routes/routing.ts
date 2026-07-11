import type { FastifyInstance } from "fastify";
import {
  createRoutingRule,
  listRoutingRules,
  getRoutingRule,
  updateRoutingRule,
  deleteRoutingRule,
} from "../services/routing.js";
import type { RoutingCondition, ReplyPolicy } from "../services/routing.js";

// Shared JSON schema fragment for ReplyPolicy — one step per stage, all optional.
const replyStepSchema = {
  type: "object",
  properties: {
    reply:          { type: "boolean" },
    jiraTransition: { type: "string" },
    prefix:         { type: "string" },
  },
} as const;
const replyPolicySchema = {
  type: ["object", "null"],
  properties: {
    onReceived: replyStepSchema,
    onSuccess:  replyStepSchema,
    onFailure:  replyStepSchema,
  },
} as const;

export default async function routingRoutes(app: FastifyInstance) {
  // POST /api/routing
  app.post<{
    Body: {
      name?: string;
      brokerId: string;
      queueId: string;
      eventTypes?: string[];
      conditions?: RoutingCondition[];
      replyTarget?: string;
      replyPolicy?: ReplyPolicy;
    };
  }>(
    "/",
    {
      schema: {
        body: {
          type: "object",
          required: ["brokerId", "queueId"],
          properties: {
            name:        { type: "string" },
            brokerId:    { type: "string" },
            queueId:     { type: "string" },
            eventTypes:  { type: "array", items: { type: "string" } },
            conditions:  {
              type: "array",
              items: {
                type: "object",
                required: ["field", "op", "value"],
                properties: {
                  field: { type: "string" },
                  op:    { type: "string", enum: ["eq", "neq", "in", "nin", "contains", "startsWith"] },
                  value: {},
                },
              },
            },
            replyTarget: { type: "string" },
            replyPolicy: replyPolicySchema,
          },
        },
      },
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const rule = await createRoutingRule(app.db, { ...req.body, ownerId: user.sub });
      return reply.code(201).send(rule);
    },
  );

  // GET /api/routing
  app.get("/", { preHandler: [app.authenticate] }, async (req) => {
    const user = req.user as { sub: string };
    return listRoutingRules(app.db, user.sub);
  });

  // GET /api/routing/:id
  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const rule = await getRoutingRule(app.db, req.params.id, user.sub);
      if (!rule) return reply.code(404).send({ error: "Routing rule not found" });
      return rule;
    },
  );

  // PATCH /api/routing/:id
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string | null;
      eventTypes?: string[] | null;
      conditions?: RoutingCondition[] | null;
      replyTarget?: string | null;
      replyPolicy?: ReplyPolicy | null;
    };
  }>(
    "/:id",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            name:        { type: ["string", "null"] },
            eventTypes:  { type: ["array", "null"], items: { type: "string" } },
            conditions:  {
              type: ["array", "null"],
              items: {
                type: "object",
                required: ["field", "op", "value"],
                properties: {
                  field: { type: "string" },
                  op:    { type: "string", enum: ["eq", "neq", "in", "nin", "contains", "startsWith"] },
                  value: {},
                },
              },
            },
            replyTarget: { type: ["string", "null"] },
            replyPolicy: replyPolicySchema,
          },
        },
      },
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const rule = await updateRoutingRule(app.db, req.params.id, user.sub, req.body);
      if (!rule) return reply.code(404).send({ error: "Routing rule not found" });
      return rule;
    },
  );

  // DELETE /api/routing/:id
  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const ok = await deleteRoutingRule(app.db, req.params.id, user.sub);
      if (!ok) return reply.code(404).send({ error: "Routing rule not found" });
      return reply.code(204).send();
    },
  );
}
