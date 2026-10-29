import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { EngineDeps } from "./engine.js";

export function engineDeps(app: FastifyInstance, log: FastifyBaseLogger): EngineDeps {
  return { db: app.db, getQueue: app.getQueue, log };
}
