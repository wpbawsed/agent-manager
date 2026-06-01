import { createHmac, timingSafeEqual } from "node:crypto";
import type { Normalizer } from "./types.js";

/**
 * Notion webhook signature format: "v1,{timestamp},{base64-signature}"
 * Signed with: HMAC-SHA256(key, "{timestamp}\n{rawBody}")
 *
 * Docs: https://developers.notion.com/docs/webhooks
 */
function verifyNotionSignature(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): boolean {
  if (!secret) return true; // Skip if no secret configured

  const sig = headers["notion-signature"] as string | undefined;
  if (!sig) return false;

  const parts = sig.split(",");
  if (parts.length < 3 || parts[0] !== "v1") return false;

  const timestamp = parts[1];
  const signature = parts[2];

  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}\n${body}`)
    .digest("base64");

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export const notionNormalizer: Normalizer = async (rawBody, headers, config) => {
  const secret = config.NOTION_WEBHOOK_SECRET ?? config.webhook_secret ?? "";

  if (secret && !verifyNotionSignature(rawBody, headers, secret)) {
    return { ok: false, status: 401, error: "Invalid Notion signature" };
  }

  const body =
    typeof rawBody === "string"
      ? JSON.parse(rawBody)
      : JSON.parse(rawBody.toString("utf-8"));

  // Notion webhook verification challenge
  if (body.verification_token) {
    return {
      ok: false,
      status: 200,
      error: JSON.stringify({ verification_token: body.verification_token }),
    };
  }

  const eventType = body.type ?? "unknown";
  const entityId = body.entity?.id ?? body.page_id ?? "";
  const entityType = body.entity?.type ?? "page";
  const authors = body.authors ?? [];
  // databaseId is in data.parent.id (type === "database")
  const databaseId = body.data?.parent?.type === "database"
    ? (body.data.parent.id as string).replace(/-/g, "")
    : null;

  // Webhook only sends property IDs — fetch page detail to get actual status value
  let status: string | null = null;
  const notionToken = config.NOTION_TOKEN ?? config.notion_token ?? "";
  if (notionToken && entityId) {
    try {
      const res = await fetch(`https://api.notion.com/v1/pages/${entityId}`, {
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": "2022-06-28",
        },
      });
      if (res.ok) {
        const page = await res.json() as Record<string, unknown>;
        const props = page.properties as Record<string, unknown> ?? {};
        const statusProp = (props["status"] ?? props["Status"] ?? props["狀態"]) as Record<string, unknown> | null;
        status = (statusProp?.status as Record<string, unknown>)?.name as string ?? null;
      }
    } catch (err) {
      console.error("[notion-webhook] Failed to fetch page detail:", (err as Error).message);
    }
  }

  return {
    ok: true,
    event: {
      sourceType: "notion",
      eventType,
      payload: {
        entityId,
        entityType,
        eventType,
        status,
        databaseId,
        authors,
        raw: body,
      },
      replyTo: `notion://${entityId}`,
      ts: body.created_time ? new Date(body.created_time).getTime() : Date.now(),
    },
  };
};
