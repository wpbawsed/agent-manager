import { pgTable, text, integer, bigint } from "drizzle-orm/pg-core";

// ── users ──────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("owner"), // owner | admin
  subdomain: text("subdomain").unique(), // tenant subdomain e.g. "wpbawsed" → wpbawsed.webhook.wpbawsed.com
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ── queues ─────────────────────────────────────────────────────────────────
// Independent BullMQ queue entity. Brokers route events into queues via routers.
// Agents consume from exactly one queue (1:1).
export const queues = pgTable("queues", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),          // BullMQ queue name, must be unique per owner
  description: text("description"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ── agents ─────────────────────────────────────────────────────────────────
// Generic worker that consumes from one queue. All agents run the same code.
// Create by selecting a queue + writing an instruction.
export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  instruction: text("instruction"),
  queueId: text("queue_id").references(() => queues.id),  // 1:1, nullable until assigned
  runtimeCmd: text("runtime_cmd"),   // command to start the worker process
  apiToken: text("api_token").unique().notNull(),
  status: text("status").notNull().default("stopped"), // stopped | running | error
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// ── brokers ────────────────────────────────────────────────────────────────
export const brokers = pgTable("brokers", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // slack | jira | github | line | railway | notion
  config: text("config").notNull(),        // JSON: signing_secret, bot_token etc.
  webhookPath: text("webhook_path").notNull(), // e.g. /slack/{sourceId} (tenant in subdomain)
  requiredVars: text("required_vars"),     // JSON: outbound credentials schema + values
  status: text("status").notNull().default("inactive"), // active | inactive | error
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// ── routing_rules ──────────────────────────────────────────────────────────
// Links a Broker to a Queue with an optional event_types allowlist (SNS-filter style).
// Empty/null event_types = catch-all (all events from that broker go to the queue).
export const routingRules = pgTable("routing_rules", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  name: text("name"),
  brokerId: text("broker_id")
    .notNull()
    .references(() => brokers.id),
  queueId: text("queue_id")
    .notNull()
    .references(() => queues.id),
  eventTypes: text("event_types"),   // JSON string[]: allowlist of eventType values. null = catch-all
  replyTarget: text("reply_target"), // Override reply URI. Null = use event's replyTo.
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ── webhook_events ─────────────────────────────────────────────────────────
// Records every incoming webhook call for audit/debug purposes.
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  brokerId: text("broker_id").notNull(),           // may be deleted later — no FK
  ownerId: text("owner_id").notNull(),
  sourceType: text("source_type").notNull(),        // slack | notion | line | ...
  eventType: text("event_type"),                    // message | url_verification | etc.
  status: text("status").notNull(),                 // challenge | queued | no_rules | inactive | error | rejected
  routed: integer("routed").notNull().default(0),   // # of queues enqueued
  errorMessage: text("error_message"),
  payloadSummary: text("payload_summary"),          // JSON truncated to 2KB
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ── agent_logs ─────────────────────────────────────────────────────────────
export const agentLogs = pgTable("agent_logs", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  ownerId: text("owner_id").notNull(),
  sessionId: text("session_id"),
  level: text("level").notNull(), // info | error
  message: text("message").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
