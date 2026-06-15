-- Agent registry: local/cloud agent types + push-based reporting
-- type=local  → agent runs on the user's machine and self-reports via push APIs
-- type=cloud  → agent is deployed to Cloudflare Sandbox by the manager

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'local';
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "endpoint" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "last_heartbeat_at" bigint;

CREATE TABLE IF NOT EXISTS "agent_metrics" (
  "id" text PRIMARY KEY NOT NULL,
  "agent_id" text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "owner_id" text NOT NULL,
  "cpu_percent" integer,
  "memory_mb" integer,
  "uptime_seconds" integer,
  "processed_count" integer,
  "error_count" integer,
  "created_at" bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_agent_metrics_agent_created"
  ON "agent_metrics" ("agent_id", "created_at" DESC);
