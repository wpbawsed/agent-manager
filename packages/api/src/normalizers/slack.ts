import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizeResult, Normalizer } from "./types.js";

function verifySlackSignature(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  signingSecret: string,
): boolean {
  const ts = headers["x-slack-request-timestamp"] as string;
  const sig = headers["x-slack-signature"] as string;
  if (!ts || !sig) return false;

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
  const base = `v0:${ts}:${body}`;
  const expected = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;

  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export const slackNormalizer: Normalizer = async (rawBody, headers, config) => {
  const body =
    typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString("utf-8"));

  const signingSecret = config.SLACK_SIGNING_SECRET ?? config.signing_secret ?? "";

  // Handle Slack URL verification challenge.
  // If a signing secret is configured, verify HMAC first (Slack does send the
  // signature header even on url_verification requests).
  // If no secret is set yet (initial setup), allow through so the URL can be
  // registered — the operator should fill in the secret immediately after.
  if (body.type === "url_verification") {
    if (signingSecret && !verifySlackSignature(rawBody, headers, signingSecret)) {
      return { ok: false, status: 401, error: "Invalid Slack signature" };
    }
    return { ok: false, status: 200, error: JSON.stringify({ challenge: body.challenge }) };
  }

  // Verify HMAC for all real events — always required
  if (!verifySlackSignature(rawBody, headers, signingSecret)) {
    return { ok: false, status: 401, error: "Invalid Slack signature" };
  }

  const event = body.event ?? body;
  const eventType = event.type ?? "unknown";
  const channelId = event.channel ?? event.channel_id ?? "";
  const userId = event.user ?? event.user_id ?? "";
  const text = event.text ?? "";
  const ts = event.ts ?? event.event_ts ?? `${Date.now()}`;

  return {
    ok: true,
    event: {
      sourceType: "slack",
      eventType,
      payload: { channelId, userId, text, raw: body },
      replyTo: `slack://${channelId}/${ts}`,
      ts: Date.now(),
    },
  };
};
