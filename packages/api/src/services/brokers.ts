import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { brokers, users } from "../db/schema.js";
import type { DB } from "../db/client.js";

// BrokerVar

export interface BrokerVar {
  key: string;
  label: string;
  placeholder?: string;
  secret: boolean;
  value: string;
}

export type BrokerType = "slack" | "jira" | "github" | "line" | "railway" | "notion";

export function defaultVarsSchema(type: BrokerType): BrokerVar[] {
  switch (type) {
    case "jira":
      return [
        { key: "JIRA_URL",             label: "Jira URL",         placeholder: "https://yourcompany.atlassian.net",     secret: false, value: "" },
        { key: "JIRA_EMAIL",           label: "Email",             placeholder: "user@company.com",                     secret: false, value: "" },
        { key: "JIRA_API_TOKEN",       label: "API Token",         placeholder: "ATATT...",                             secret: true,  value: "" },
        { key: "JIRA_ACCOUNT_ID",      label: "Account ID",        placeholder: "712020:xxx-xxx",                       secret: false, value: "" },
        { key: "JIRA_WEBHOOK_SECRET",  label: "Webhook Secret",    placeholder: "(optional HMAC secret)",               secret: true,  value: "" },
      ];
    case "notion":
      return [
        { key: "NOTION_TOKEN",       label: "Integration Token", placeholder: "ntn_...",                                    secret: true,  value: "" },
        { key: "NOTION_DATABASE_ID", label: "Database ID",       placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",       secret: false, value: "" },
      ];
    case "slack":
      return [
        { key: "SLACK_BOT_TOKEN",       label: "Bot Token",       placeholder: "xoxb-...", secret: true,  value: "" },
        { key: "SLACK_SIGNING_SECRET",  label: "Signing Secret",  placeholder: "abc123...", secret: true, value: "" },
      ];
    case "github":
      return [
        { key: "GITHUB_TOKEN",           label: "Personal Access Token", placeholder: "ghp_...",    secret: true,  value: "" },
        { key: "GITHUB_WEBHOOK_SECRET",  label: "Webhook Secret",        placeholder: "your-secret", secret: true, value: "" },
      ];
    case "line":
      return [
        { key: "LINE_CHANNEL_TOKEN",   label: "Channel Access Token", placeholder: "xxx...",       secret: true, value: "" },
        { key: "LINE_CHANNEL_SECRET",  label: "Channel Secret",       placeholder: "abc123...",    secret: true, value: "" },
      ];
    case "railway":
      return [
        { key: "RAILWAY_WEBHOOK_SECRET", label: "Webhook Secret", placeholder: "your-secret", secret: true, value: "" },
      ];
  }
}

// CRUD

export interface CreateBrokerInput {
  name: string;
  type: BrokerType;
  config: Record<string, unknown>;
  ownerId: string;
  requiredVars?: BrokerVar[];
}

export async function createBroker(db: DB, input: CreateBrokerInput) {
  const id = randomUUID();
  const now = Date.now();

  // Look up owner subdomain to build the full webhook path
  const [owner] = await db.select({ subdomain: users.subdomain }).from(users).where(eq(users.id, input.ownerId)).limit(1);
  const subdomain = owner?.subdomain;

  // Webhook path: /{tenant}/{type}/{id} — e.g. /wpbawsed/slack/uuid
  const webhookPath = subdomain ? `/${subdomain}/${input.type}/${id}` : `/${input.type}/${id}`;

  const vars = input.requiredVars ?? defaultVarsSchema(input.type);

  const [broker] = await db
    .insert(brokers)
    .values({
      id,
      ownerId: input.ownerId,
      name: input.name,
      type: input.type,
      config: JSON.stringify(input.config),
      webhookPath,
      requiredVars: JSON.stringify(vars),
      status: "inactive",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return broker;
}

export async function listBrokers(db: DB, ownerId: string) {
  return db.select().from(brokers).where(eq(brokers.ownerId, ownerId));
}

export async function getBroker(db: DB, id: string, ownerId: string) {
  const [broker] = await db
    .select()
    .from(brokers)
    .where(and(eq(brokers.id, id), eq(brokers.ownerId, ownerId)))
    .limit(1);
  return broker ?? null;
}

export async function updateBroker(
  db: DB,
  id: string,
  ownerId: string,
  patch: { name?: string; config?: Record<string, unknown>; requiredVars?: BrokerVar[] },
) {
  const existing = await getBroker(db, id, ownerId);
  if (!existing) return null;

  // Merge config instead of replacing — prevents accidental key deletion
  let mergedConfig: string | undefined;
  if (patch.config) {
    const currentConfig = JSON.parse(existing.config ?? "{}") as Record<string, unknown>;
    mergedConfig = JSON.stringify({ ...currentConfig, ...patch.config });
  }

  const [updated] = await db
    .update(brokers)
    .set({
      ...(patch.name ? { name: patch.name } : {}),
      ...(mergedConfig !== undefined ? { config: mergedConfig } : {}),
      ...(patch.requiredVars ? { requiredVars: JSON.stringify(patch.requiredVars) } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(brokers.id, id))
    .returning();

  return updated ?? null;
}

export async function updateBrokerStatus(
  db: DB,
  id: string,
  ownerId: string,
  status: "active" | "inactive" | "error",
) {
  const existing = await getBroker(db, id, ownerId);
  if (!existing) return null;

  const [updated] = await db
    .update(brokers)
    .set({ status, updatedAt: Date.now() })
    .where(eq(brokers.id, id))
    .returning();

  return updated ?? null;
}

export async function deleteBroker(db: DB, id: string, ownerId: string) {
  const existing = await getBroker(db, id, ownerId);
  if (!existing) return false;
  await db.delete(brokers).where(eq(brokers.id, id));
  return true;
}
