import { pgTable, text, integer, bigint, doublePrecision, uniqueIndex } from "drizzle-orm/pg-core";

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
// Registry entry for a worker that consumes from one queue.
// Every agent runs its own runtime and self-reports via the
// /internal/agents/:id/* push APIs; the manager never starts or stops it.
// type only records where it runs: local (the user's machine) | cloud.
export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  instruction: text("instruction"),
  queueId: text("queue_id").references(() => queues.id),  // 1:1, nullable until assigned
  type: text("type").notNull().default("local"),          // local | cloud
  endpoint: text("endpoint"),        // optional URL of a local agent (informational)
  apiToken: text("api_token").unique().notNull(),
  status: text("status").notNull().default("stopped"), // stopped | running | idle | error
  lastHeartbeatAt: bigint("last_heartbeat_at", { mode: "number" }), // last push from the agent
  brainCommit: text("brain_commit"),         // brain repo commit the agent last reported (heartbeat)
  brainPullError: text("brain_pull_error"),  // last brain pull failure; null once a pull succeeds
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// ── agent_metrics ──────────────────────────────────────────────────────────
// Time-series snapshots pushed by agents via POST /internal/agents/:id/metrics.
export const agentMetrics = pgTable("agent_metrics", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  cpuPercent: integer("cpu_percent"),
  memoryMb: integer("memory_mb"),
  uptimeSeconds: integer("uptime_seconds"),
  processedCount: integer("processed_count"),
  errorCount: integer("error_count"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
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
  // Target is either a queue (queueId) or a workflow (workflowId) — exactly one is set.
  queueId: text("queue_id").references(() => queues.id),
  workflowId: text("workflow_id").references(() => workflows.id),
  eventTypes: text("event_types"),   // JSON string[]: allowlist of eventType values. null = catch-all
  conditions: text("conditions"),    // JSON RoutingCondition[]: payload-level filter. null = pass-through
  replyTarget: text("reply_target"), // Override reply URI. Null = use event's replyTo.
  replyPolicy: text("reply_policy"), // JSON ReplyPolicy: { onReceived?, onSuccess?, onFailure? }. null = no auto reply.
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

// ── reply_contexts ─────────────────────────────────────────────────────────
// Written at enqueue time so the ReplyInterceptor can resolve where/what/how to
// reply when the agent reports its result back (PATCH /internal/events/:id).
// Keyed by eventId; deleted after the reply fires. One row per event (first
// matched rule with a replyPolicy wins if an event fans out to multiple rules).
export const replyContexts = pgTable("reply_contexts", {
  eventId: text("event_id").primaryKey(),
  brokerId: text("broker_id").notNull(),      // to load outbound tokens from broker.requiredVars
  replyTo: text("reply_to"),                  // e.g. slack://C123/ts, jira://PROJ-1
  jiraIssueKey: text("jira_issue_key"),       // parsed from a jira:// replyTo, for transitions
  policy: text("policy").notNull(),           // JSON ReplyPolicy
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

// ── agent_runs ─────────────────────────────────────────────────────────────
// One row per (agent, event) the agent processed. Source for per-agent stats
// (success/fail counts, duration, cost). webhook_events can't serve this: one
// webhook eventId fans out to every matching queue and carries no agentId.
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    eventId: text("event_id").notNull(),
    status: text("status").notNull(), // running | done | failed
    costUsd: doublePrecision("cost_usd"),
    durationMs: integer("duration_ms"),
    numTurns: integer("num_turns"),
    error: text("error"),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    endedAt: bigint("ended_at", { mode: "number" }),
  },
  (t) => ({ agentEvent: uniqueIndex("uq_agent_runs_agent_event").on(t.agentId, t.eventId) }),
);

// ── workflows ──────────────────────────────────────────────────────────────
// A graph of agents (LangGraph-style). The graph itself lives in immutable
// workflow_versions rows; editing a workflow creates a new version.
export const workflows = pgTable("workflows", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  currentVersionId: text("current_version_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const workflowVersions = pgTable("workflow_versions", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  graph: text("graph").notNull(), // JSON WorkflowGraph (see workflow/graph.ts)
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ── workflow_runs ──────────────────────────────────────────────────────────
// One execution of a workflow, pinned to the version current when it started.
export const workflowRuns = pgTable("workflow_runs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull(),
  originEventId: text("origin_event_id"),
  brokerId: text("broker_id"),
  ruleId: text("rule_id"),
  sourceType: text("source_type"),
  replyTo: text("reply_to"),         // rule.replyTarget already applied
  replyPolicy: text("reply_policy"), // JSON ReplyPolicy copied from the rule at start; used at END
  status: text("status").notNull(),  // running | interrupted | done | failed | cancelled
  currentNode: text("current_node"),
  steps: integer("steps").notNull().default(0), // count of kind=run steps (maxSteps applies to this)
  state: text("state").notNull(),    // JSON RunState
  error: text("error"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// ── workflow_steps ─────────────────────────────────────────────────────────
// Checkpoints: one row per enqueue (or gate). eventId is unique per step —
// BullMQ keeps completed jobs, so re-using an eventId would drop the job.
export const workflowSteps = pgTable("workflow_steps", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => workflowRuns.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  node: text("node").notNull(),
  agentId: text("agent_id"),
  eventId: text("event_id").notNull().unique(), // "wf_{runId}_{seq}"
  kind: text("kind").notNull(),    // run | retry | resume | gate
  attempt: integer("attempt").notNull().default(1),
  status: text("status").notNull(), // queued | running | done | failed | interrupted
  input: text("input"),
  human: text("human"),
  result: text("result"),           // JSON StepResult
  startedAt: bigint("started_at", { mode: "number" }),
  endedAt: bigint("ended_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
