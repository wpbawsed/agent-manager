import fp from "fastify-plugin";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
    getQueue: (queueName: string) => Queue;
  }
}

export default fp(async (fastify) => {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  redis.on("error", (err: Error) => {
    fastify.log.error({ err }, "[redis] connection error");
  });

  redis.on("connect", () => {
    fastify.log.info("[redis] connected");
  });

  const queues = new Map<string, Queue>();

  function getQueue(queueName: string): Queue {
    if (!queues.has(queueName)) {
      queues.set(queueName, new Queue(queueName, { connection: redis }));
    }
    return queues.get(queueName)!;
  }

  fastify.decorate("redis", redis);
  fastify.decorate("getQueue", getQueue);

  fastify.addHook("onClose", async () => {
    for (const q of queues.values()) await q.close();
    await redis.quit();
  });
});
