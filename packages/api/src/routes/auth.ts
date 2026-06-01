import type { FastifyInstance } from "fastify";
import { registerUser, loginUser, getUserById } from "../services/auth.js";

const registerSchema = {
  body: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string", minLength: 8 },
      subdomain: { type: "string", minLength: 1, pattern: "^[a-z0-9-]+$" },
    },
    additionalProperties: false,
  },
};

const loginSchema = {
  body: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string" },
    },
    additionalProperties: false,
  },
};

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/register
  fastify.post("/register", { schema: registerSchema }, async (req, reply) => {
    const body = req.body as { email: string; password: string; subdomain?: string };
    try {
      const user = await registerUser(fastify.db, body);
      const token = await reply.jwtSign(
        { sub: user.id, email: user.email, role: user.role },
        { expiresIn: "7d" },
      );
      return reply.status(201).send({ user, token });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
  });

  // POST /api/auth/login
  fastify.post("/login", { schema: loginSchema }, async (req, reply) => {
    const body = req.body as { email: string; password: string };
    try {
      const user = await loginUser(fastify.db, body);
      const token = await reply.jwtSign(
        { sub: user.id, email: user.email, role: user.role },
        { expiresIn: "7d" },
      );
      return reply.send({ user, token });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
  });

  // GET /api/auth/me
  fastify.get(
    "/me",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const payload = req.user as { sub: string };
      try {
        const user = await getUserById(fastify.db, payload.sub);
        return reply.send({ user });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({ error: err.message });
      }
    },
  );
}
