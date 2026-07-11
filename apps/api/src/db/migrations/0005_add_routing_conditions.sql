-- Add payload-level conditions filter to routing_rules.
-- Format: JSON array of { field, op, value } objects.
--   field: top-level event field (eventType, sourceType) or payload sub-field (projectKey, status, assignee, issueKey, summary)
--   op:    "eq" | "neq" | "in" | "nin" | "contains" | "startsWith"
--   value: string or string[] depending on op
-- null = no extra filtering (pass-through, same as before)
ALTER TABLE "routing_rules" ADD COLUMN IF NOT EXISTS "conditions" TEXT;
