import type { FastifyInstance } from "fastify";
import { users, agents, brokers, queues, routingRules, webhookEvents } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

export default async function adminRoutes(app: FastifyInstance) {
  // Require admin on all routes in this plugin
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", async (req, reply) => {
    const user = req.user as { role: string };
    if (!["admin", "owner"].includes(user.role)) {
      return reply.status(403).send({ error: "Admin only" });
    }
  });

  // GET /api/admin/stats — summary counts
  app.get("/stats", async (_req, reply) => {
    const [[userCount], [agentCount], [brokerCount], [queueCount], [routingCount], [eventCount]] =
      await Promise.all([
        app.db.select({ count: sql<number>`count(*)::int` }).from(users),
        app.db.select({ count: sql<number>`count(*)::int` }).from(agents),
        app.db.select({ count: sql<number>`count(*)::int` }).from(brokers),
        app.db.select({ count: sql<number>`count(*)::int` }).from(queues),
        app.db.select({ count: sql<number>`count(*)::int` }).from(routingRules),
        app.db.select({ count: sql<number>`count(*)::int` }).from(webhookEvents),
      ]);
    return reply.send({
      users: userCount.count,
      agents: agentCount.count,
      brokers: brokerCount.count,
      queues: queueCount.count,
      routingRules: routingCount.count,
      webhookEvents: eventCount.count,
    });
  });

  // GET /api/admin/users — list all users
  app.get("/users", async (_req, reply) => {
    const rows = await app.db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users);
    return reply.send({ users: rows });
  });

  // PATCH /api/admin/users/:id — update role
  app.patch<{
    Params: { id: string };
    Body: { role?: string; password?: string };
  }>("/users/:id", async (req, reply) => {
    const { id } = req.params;
    const { role, password } = req.body;

    const updates: Record<string, unknown> = {};
    if (role) {
      if (!["owner", "admin"].includes(role)) {
        return reply.status(400).send({ error: "Invalid role" });
      }
      updates.role = role;
    }
    if (password) {
      if (password.length < 8) {
        return reply.status(400).send({ error: "Password too short" });
      }
      updates.passwordHash = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: "Nothing to update" });
    }

    const [updated] = await app.db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();

    if (!updated) return reply.status(404).send({ error: "User not found" });
    return reply.send({
      user: { id: updated.id, email: updated.email, role: updated.role },
    });
  });

  // DELETE /api/admin/users/:id
  app.delete<{ Params: { id: string } }>("/users/:id", async (req, reply) => {
    const { id } = req.params;
    const [deleted] = await app.db
      .delete(users)
      .where(eq(users.id, id))
      .returning();
    if (!deleted) return reply.status(404).send({ error: "User not found" });
    return reply.status(204).send();
  });
}
