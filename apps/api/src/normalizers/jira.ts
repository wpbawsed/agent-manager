import { createHmac, timingSafeEqual } from "node:crypto";
import type { Normalizer } from "./types.js";

function verifyJiraSignature(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): boolean {
  // Jira uses x-hub-signature (SHA-256) for Connect apps
  const sig = (headers["x-hub-signature"] ?? headers["x-atlassian-webhook-identifier"]) as string | undefined;
  if (!sig || !secret) return true; // Jira doesn't always sign; skip if no secret configured
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export const jiraNormalizer: Normalizer = async (rawBody, headers, config) => {
  if (!verifyJiraSignature(rawBody, headers, config.JIRA_WEBHOOK_SECRET ?? config.webhook_secret ?? "")) {
    return { ok: false, status: 401, error: "Invalid Jira signature" };
  }

  const body =
    typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString("utf-8"));

  const webhookEvent = body.webhookEvent ?? "unknown";
  const issue = body.issue ?? {};
  const issueKey = issue.key ?? "";
  const projectKey = issueKey.split("-")[0] ?? "";

  return {
    ok: true,
    event: {
      sourceType: "jira",
      eventType: webhookEvent,
      payload: {
        webhookEvent,
        issueKey,
        projectKey,
        summary: issue.fields?.summary ?? "",
        status: issue.fields?.status?.name ?? "",
        assignee: issue.fields?.assignee?.emailAddress ?? "",
        raw: body,
      },
      replyTo: `jira://${issueKey}`,
      ts: Date.now(),
    },
  };
};
