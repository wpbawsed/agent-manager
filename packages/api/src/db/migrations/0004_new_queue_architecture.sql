-- Migration: Introduce independent Queue entity + decouple routing_rules from agents
-- Queues are now first-class entities (like SQS). Agents subscribe 1:1 to a queue.
-- Routing rules route Broker → Queue (not Broker → Agent).

-- 1. Create queues table
CREATE TABLE "queues" (
    "id" text PRIMARY KEY NOT NULL,
    "owner_id" text NOT NULL REFERENCES "users"("id"),
    "name" text NOT NULL,
    "description" text,
    "created_at" bigint NOT NULL
);

-- 2. Add queue_id to agents (nullable — agent can exist before queue is assigned)
ALTER TABLE "agents" ADD COLUMN "queue_id" text REFERENCES "queues"("id");

-- 3. Remove obsolete agent columns
ALTER TABLE "agents" DROP COLUMN IF EXISTS "broker_id";
ALTER TABLE "agents" DROP COLUMN IF EXISTS "queue_name";
ALTER TABLE "agents" DROP COLUMN IF EXISTS "skills";
ALTER TABLE "agents" DROP COLUMN IF EXISTS "mcp_config";
ALTER TABLE "agents" DROP COLUMN IF EXISTS "runtime_type";
ALTER TABLE "agents" DROP COLUMN IF EXISTS "variables";

-- 4. Modify routing_rules: replace agent_id + conditions with queue_id + event_types
ALTER TABLE "routing_rules" ADD COLUMN "queue_id" text REFERENCES "queues"("id");
ALTER TABLE "routing_rules" ADD COLUMN "event_types" text;   -- JSON string[], null = catch-all
ALTER TABLE "routing_rules" ADD COLUMN "name" text;
ALTER TABLE "routing_rules" DROP COLUMN IF EXISTS "agent_id";
ALTER TABLE "routing_rules" DROP COLUMN IF EXISTS "conditions";

-- Make queue_id NOT NULL after add (safe because table is empty in dev)
ALTER TABLE "routing_rules" ALTER COLUMN "queue_id" SET NOT NULL;
