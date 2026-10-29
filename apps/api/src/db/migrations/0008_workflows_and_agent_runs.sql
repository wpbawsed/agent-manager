-- Phase 4（系統整合設計 §4、§6）：工作流層 ＋ per-agent 執行紀錄。
-- 慣例同 0001-0007：idempotent，可重複套用。全部是新增，不刪、不搬資料；
-- 唯一放寬的是 routing_rules.queue_id 的 NOT NULL（目標改成 queue 或 workflow 二選一）。

CREATE TABLE IF NOT EXISTS "workflows" (
  "id"                 text PRIMARY KEY NOT NULL,
  "owner_id"           text NOT NULL REFERENCES "users"("id"),
  "name"               text NOT NULL,
  "description"        text,
  "current_version_id" text,
  "created_at"         bigint NOT NULL,
  "updated_at"         bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS "workflow_versions" (
  "id"          text PRIMARY KEY NOT NULL,
  "workflow_id" text NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
  "version"     integer NOT NULL,
  "graph"       text NOT NULL,
  "created_at"  bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_workflow_versions_workflow_version"
  ON "workflow_versions" ("workflow_id", "version");

CREATE TABLE IF NOT EXISTS "workflow_runs" (
  "id"              text PRIMARY KEY NOT NULL,
  "owner_id"        text NOT NULL,
  "workflow_id"     text NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
  "version_id"      text NOT NULL,
  "origin_event_id" text,
  "broker_id"       text,
  "rule_id"         text,
  "source_type"     text,
  "reply_to"        text,
  "reply_policy"    text,
  "status"          text NOT NULL,
  "current_node"    text,
  "steps"           integer NOT NULL DEFAULT 0,
  "state"           text NOT NULL,
  "error"           text,
  "created_at"      bigint NOT NULL,
  "updated_at"      bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_workflow_runs_owner_status"
  ON "workflow_runs" ("owner_id", "status", "updated_at" DESC);

CREATE TABLE IF NOT EXISTS "workflow_steps" (
  "id"         text PRIMARY KEY NOT NULL,
  "run_id"     text NOT NULL REFERENCES "workflow_runs"("id") ON DELETE CASCADE,
  "seq"        integer NOT NULL,
  "node"       text NOT NULL,
  "agent_id"   text,
  "event_id"   text NOT NULL UNIQUE,
  "kind"       text NOT NULL,
  "attempt"    integer NOT NULL DEFAULT 1,
  "status"     text NOT NULL,
  "input"      text,
  "human"      text,
  "result"     text,
  "started_at" bigint,
  "ended_at"   bigint,
  "created_at" bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_workflow_steps_run_seq" ON "workflow_steps" ("run_id", "seq");

CREATE TABLE IF NOT EXISTS "agent_runs" (
  "id"          text PRIMARY KEY NOT NULL,
  "agent_id"    text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "owner_id"    text NOT NULL,
  "event_id"    text NOT NULL,
  "status"      text NOT NULL,
  "cost_usd"    double precision,
  "duration_ms" integer,
  "num_turns"   integer,
  "error"       text,
  "started_at"  bigint NOT NULL,
  "ended_at"    bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_agent_runs_agent_event" ON "agent_runs" ("agent_id", "event_id");
CREATE INDEX IF NOT EXISTS "idx_agent_runs_agent_started" ON "agent_runs" ("agent_id", "started_at" DESC);

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "brain_commit" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "brain_pull_error" text;

ALTER TABLE "routing_rules" ADD COLUMN IF NOT EXISTS "workflow_id" text REFERENCES "workflows"("id");
ALTER TABLE "routing_rules" ALTER COLUMN "queue_id" DROP NOT NULL;
