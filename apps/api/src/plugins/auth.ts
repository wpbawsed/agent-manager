import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (fastify) => {
  fastify.decorate(
    "authenticate",
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        // EventSource cannot set headers; fallback to ?token= query param
        const query = req.query as Record<string, string>;
        if (!req.headers.authorization && query?.token) {
          req.headers.authorization = `Bearer ${query.token}`;
        }
        await req.jwtVerify();
      } catch {
        reply.status(401).send({ error: "Unauthorized" });
      }
    },
  );
});
