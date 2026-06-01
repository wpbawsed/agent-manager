-- Allow a routing_rule to override the reply target.
-- When set, the broker sends replies to this URI instead of the inbound replyTo.
-- Example: Railway event → reply to slack://C1234567
ALTER TABLE "routing_rules" ADD COLUMN IF NOT EXISTS "reply_target" TEXT;
