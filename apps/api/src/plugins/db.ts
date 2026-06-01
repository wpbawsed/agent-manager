import fp from "fastify-plugin";
import { db } from "../db/client.js";

declare module "fastify" {
  interface FastifyInstance {
    db: typeof db;
  }
}

export default fp(async (fastify) => {
  fastify.decorate("db", db);
});
