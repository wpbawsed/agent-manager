-- Add subdomain to users for tenant-based webhook URLs
-- e.g. wpbawsed.webhook.wpbawsed.com/slack/{sourceId}
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subdomain" text;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT IF NOT EXISTS "users_subdomain_unique" UNIQUE("subdomain");
