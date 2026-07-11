import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { brokers, routingRules, queues, users, webhookEvents, replyContexts } from "../db/schema.js";
import { normalizers } from "../normalizers/index.js";
import { runAck, resolveIssueKey, type ReplyPolicy } from "../lib/reply-policy.js";

const SUPPORTED_TYPES = ["slack", "jira", "github", "line", "railway", "notion"] as const;
type SourceType = typeof SUPPORTED_TYPES[number];

export default async function webhookRoutes(app: FastifyInstance) {
  // Add a content-type parser so we can read the raw body for HMAC verification
  app.addContentTypeParser(
    ["application/json", "application/x-www-form-urlencoded", "text/plain"],
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );

  /**
   * POST /:tenant/:sourceType/:sourceId
   *
   * URL: webhook.wpbawsed.com/{tenant}/{type}/{sourceId}
   * Example: webhook.wpbawsed.com/wpbawsed/slack/uuid
   *
   * No auth required — HMAC signature in each normalizer guards access.
   */
  app.post<{ Params: { tenant: string; sourceType: string; sourceId: string } }>(
    "/:tenant/:sourceType/:sourceId",
    {
      schema: {
        params: {
          type: "object",
          required: ["tenant", "sourceType", "sourceId"],
          properties: {
            tenant: { type: "string" },
            sourceType: { type: "string", enum: SUPPORTED_TYPES as unknown as string[] },
            sourceId: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const { tenant, sourceType, sourceId } = req.params;
      const now = Date.now();

      // Raw body log — useful for inspecting unknown webhook payloads (e.g. Railway)
      req.log.info(
        {
          webhook: {
            tenant,
            sourceType,
            sourceId,
            headers: req.headers,
            body: (() => {
              try {
                return JSON.parse((req.body as Buffer).toString("utf8"));
              } catch {
                return (req.body as Buffer).toString("utf8");
              }
            })(),
          },
        },
        "[webhook] raw incoming request",
      );

      // Helper: fire-and-forget webhook event log insert (never throws)
      const logWebhookEvent = (fields: {
        brokerId: string;
        ownerId: string;
        sourceType: string;
        eventType?: string;
        status: string;
        routed?: number;
        errorMessage?: string;
        payloadSummary?: string;
      }) => {
        const summary = fields.payloadSummary
          ? fields.payloadSummary.slice(0, 2048)
          : undefined;
        app.db
          .insert(webhookEvents)
          .values({
            id: randomUUID(),
            brokerId: fields.brokerId,
            ownerId: fields.ownerId,
            sourceType: fields.sourceType,
            eventType: fields.eventType ?? null,
            status: fields.status,
            routed: fields.routed ?? 0,
            errorMessage: fields.errorMessage ?? null,
            payloadSummary: summary ?? null,
            createdAt: now,
          })
          .catch((err: unknown) => req.log.error({ err }, "Failed to write webhook_event log"));
      };

      // 1. Resolve tenant → ownerId via subdomain field
      const [user] = await app.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.subdomain, tenant))
        .limit(1);

      if (!user) {
        return reply.code(404).send({ error: "Tenant not found" });
      }

      // 2. Look up broker by id + type + owner
      const [broker] = await app.db
        .select()
        .from(brokers)
        .where(
          and(
            eq(brokers.id, sourceId),
            eq(brokers.type, sourceType),
            eq(brokers.ownerId, user.id),
          ),
        )
        .limit(1);

      if (!broker) {
        return reply.code(404).send({ error: "Source not found" });
      }

      // 3. Find the right normalizer
      const normalizer = normalizers[broker.type];
      if (!normalizer) {
        return reply.code(422).send({ error: `Unsupported broker type: ${broker.type}` });
      }

      // 4. Normalize + verify signature
      //    Run BEFORE status check so URL verification challenges (Slack, Notion, Line)
      //    are handled even when the broker is still inactive.
      const config = JSON.parse(broker.config) as Record<string, string>;
      const rawBody = req.body as Buffer;
      const headers = req.headers as Record<string, string | string[] | undefined>;

      const result = await normalizer(rawBody, headers, config);

      if (!result.ok) {
        // status=200 means it's a platform verification challenge — return immediately,
        // no broker status check required.
        if (result.status === 200) {
          logWebhookEvent({
            brokerId: broker.id,
            ownerId: user.id,
            sourceType,
            eventType: "url_verification",
            status: "challenge",
          });
          return reply
            .code(200)
            .header("Content-Type", "application/json")
            .send(result.error);
        }
        // HMAC failed — reject silently, no DB log
        return reply.code(result.status).send({ error: result.error });
      }

      // 5. Now enforce broker status for real events
      if (broker.status !== "active") {
        return reply.code(403).send({ error: "Source inactive" });
      }

      // 6. Query routing rules for this broker, join queues to get queue name
      const rules = await app.db
        .select({
          id: routingRules.id,
          queueId: routingRules.queueId,
          queueName: queues.name,
          eventTypes: routingRules.eventTypes,
          conditions: routingRules.conditions,
          replyTarget: routingRules.replyTarget,
          replyPolicy: routingRules.replyPolicy,
        })
        .from(routingRules)
        .innerJoin(queues, eq(routingRules.queueId, queues.id))
        .where(eq(routingRules.brokerId, broker.id));

      if (rules.length === 0) {
        req.log.warn({ sourceId: broker.id }, "No routing rules found for broker");
        return reply.code(200).send({ ok: true, routed: 0 });
      }

      // 7. Fan-out: enqueue to each matching queue
      const eventId = randomUUID();
      const agentEvent = {
        eventId,
        brokerId: broker.id,
        ...result.event,
      };

      let routed = 0;
      const errors: string[] = [];
      // 第一個帶 replyPolicy 的 matched rule 作為本事件的 reply 綁定（ack 現在做、reply 之後做）
      let replyBinding: { replyTo: string | null; policy: ReplyPolicy } | null = null;

      for (const rule of rules) {
        // Filter by event_types allowlist (empty/null = catch-all)
        if (rule.eventTypes) {
          try {
            const allowlist = JSON.parse(rule.eventTypes) as string[];
            if (allowlist.length > 0 && !allowlist.includes(agentEvent.eventType)) continue;
          } catch {
            req.log.warn({ ruleId: rule.id }, "Failed to parse rule event_types");
          }
        }

        // Filter by payload conditions (empty/null = pass-through)
        if (rule.conditions) {
          try {
            const conditions = JSON.parse(rule.conditions) as Array<{
              field: string;
              op: string;
              value: string | string[];
            }>;
            if (conditions.length > 0) {
              const payload = (agentEvent as Record<string, unknown>).payload as Record<string, unknown> ?? {};
              const topLevel = agentEvent as Record<string, unknown>;
              const passed = conditions.every(({ field, op, value }) => {
                const actual = String(payload[field] ?? topLevel[field] ?? "");
                switch (op) {
                  case "eq":         return actual === String(value);
                  case "neq":        return actual !== String(value);
                  case "in":         return (value as string[]).includes(actual);
                  case "nin":        return !(value as string[]).includes(actual);
                  case "contains":   return actual.toLowerCase().includes(String(value).toLowerCase());
                  case "startsWith": return actual.toLowerCase().startsWith(String(value).toLowerCase());
                  default:           return true;
                }
              });
              if (!passed) {
                req.log.info({ ruleId: rule.id }, "Event filtered by conditions");
                continue;
              }
            }
          } catch {
            req.log.warn({ ruleId: rule.id }, "Failed to parse rule conditions");
          }
        }

        if (!rule.queueName) {
          req.log.warn({ ruleId: rule.id, queueId: rule.queueId }, "Queue has no name, skipping");
          continue;
        }

        try {
          const queue = app.getQueue(rule.queueName);
          const replyTo =
            rule.replyTarget ??
            ((agentEvent as Record<string, unknown>).replyTo as string | undefined) ??
            null;
          const jobData = replyTo ? { ...agentEvent, replyTo } : agentEvent;
          await queue.add("agent-event", jobData, {
            jobId: eventId, // 冪等：webhook 重送 → 同一 eventId 不會重跑
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 500 },
          });
          routed++;
          // 捕捉本事件的 reply 綁定（第一個有 policy 的 rule 勝出）
          if (!replyBinding && rule.replyPolicy) {
            try {
              replyBinding = { replyTo, policy: JSON.parse(rule.replyPolicy) as ReplyPolicy };
            } catch {
              req.log.warn({ ruleId: rule.id }, "Failed to parse reply_policy");
            }
          }
          req.log.info(
            { eventId, queueId: rule.queueId, queue: rule.queueName },
            "Event enqueued",
          );
        } catch (err) {
          req.log.error({ err, queueId: rule.queueId }, "Failed to enqueue event");
          errors.push(rule.queueId);
        }
      }

      // Reply policy：持久化 reply context（供之後 ReplyInterceptor 取用）+ 立刻執行 ack
      if (replyBinding) {
        await app.db
          .insert(replyContexts)
          .values({
            eventId,
            brokerId: broker.id,
            replyTo: replyBinding.replyTo,
            jiraIssueKey: resolveIssueKey(replyBinding.replyTo) ?? null,
            policy: JSON.stringify(replyBinding.policy),
            createdAt: Date.now(),
          })
          .onConflictDoNothing();
        runAck(app.db, {
          brokerId: broker.id,
          replyTo: replyBinding.replyTo,
          policy: replyBinding.policy,
        });
      }

      // Only write to DB if at least one agent was matched and enqueued
      if (routed > 0 || errors.length > 0) {
        logWebhookEvent({
          brokerId: broker.id,
          ownerId: user.id,
          sourceType,
          eventType: result.event?.eventType,
          status: errors.length > 0 ? "error" : "queued",
          routed,
          errorMessage: errors.length > 0 ? `Failed agents: ${errors.join(",")}` : undefined,
          payloadSummary: JSON.stringify(result.event?.payload ?? {}),
        });
      }

      return reply.code(200).send({ ok: true, eventId, routed, errors });
    },
  );
}
