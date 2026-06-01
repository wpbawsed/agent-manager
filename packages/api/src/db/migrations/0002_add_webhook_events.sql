-- Migration: add webhook_events table for audit logging of all incoming webhooks
CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id"              TEXT PRIMARY KEY,
  "broker_id"       TEXT NOT NULL,
  "owner_id"        TEXT NOT NULL,
  "source_type"     TEXT NOT NULL,
  "event_type"      TEXT,
  "status"          TEXT NOT NULL,
  "routed"          INTEGER NOT NULL DEFAULT 0,
  "error_message"   TEXT,
  "payload_summary" TEXT,
  "created_at"      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS "webhook_events_broker_id_idx" ON "webhook_events" ("broker_id");
CREATE INDEX IF NOT EXISTS "webhook_events_owner_id_idx"  ON "webhook_events" ("owner_id");
CREATE INDEX IF NOT EXISTS "webhook_events_created_at_idx" ON "webhook_events" ("created_at" DESC);
