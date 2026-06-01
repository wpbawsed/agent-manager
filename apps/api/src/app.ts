import "dotenv/config";
import Fastify from "fastify";
import fjwt from "@fastify/jwt";
import fcors from "@fastify/cors";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

async function start() {
  // 1. Ecosystem plugins
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",")
    : ["http://localhost:3000", "http://127.0.0.1:3000"];
  await app.register(fcors, {
    origin: (origin, cb) =>
      cb(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
  });

  await app.register(fjwt, {
    secret: process.env.JWT_SECRET || "change-me-in-production",
  });

  // 2. Custom plugins
  await app.register((await import("./plugins/db.js")).default);
  await app.register((await import("./plugins/auth.js")).default);
  await app.register((await import("./plugins/bullmq.js")).default);

  // 3. Routes
  await app.register((await import("./routes/webhook.js")).default, {
    prefix: "",
  });
  await app.register((await import("./routes/auth.js")).default, {
    prefix: "/api/auth",
  });
  await app.register((await import("./routes/agents.js")).default, {
    prefix: "/api/agents",
  });
  await app.register((await import("./routes/agent-files.js")).default, {
    prefix: "/api/agents",
  });
  await app.register((await import("./routes/brokers.js")).default, {
    prefix: "/api/brokers",
  });
  await app.register((await import("./routes/queues.js")).default, {
    prefix: "/api/queues",
  });
  await app.register((await import("./routes/routing.js")).default, {
    prefix: "/api/routing",
  });
  await app.register((await import("./routes/logs.js")).default, {
    prefix: "/api/logs",
  });
  await app.register((await import("./routes/playground.js")).default, {
    prefix: "/api/playground",
  });
  await app.register((await import("./routes/admin.js")).default, {
    prefix: "/api/admin",
  });
  await app.register((await import("./routes/internal.js")).default, {
    prefix: "/internal",
  });

  // Health check
  app.get("/health", async () => ({ status: "ok", ts: Date.now() }));

  const port = Number(process.env.PORT) || 8080;
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`API Server listening on port ${port}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
