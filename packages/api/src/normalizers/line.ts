import { createHmac, timingSafeEqual } from "node:crypto";
import type { Normalizer } from "./types.js";

function verifyLineSignature(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  channelSecret: string,
): boolean {
  const sig = headers["x-line-signature"] as string;
  if (!sig) return false;
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
  const expected = createHmac("sha256", channelSecret).update(body).digest("base64");
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export const lineNormalizer: Normalizer = async (rawBody, headers, config) => {
  const channelSecret = config.LINE_CHANNEL_SECRET ?? config.channel_secret ?? "";
  if (channelSecret && !verifyLineSignature(rawBody, headers, channelSecret)) {
    return { ok: false, status: 401, error: "Invalid LINE signature" };
  }

  const body =
    typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString("utf-8"));

  const events = body.events ?? [];
  if (events.length === 0) {
    return { ok: false, status: 200, error: "no events" };
  }

  // Take the first event (webhook-route will loop if multiple)
  const ev = events[0];
  const userId     = ev.source?.userId ?? "";
  const groupId    = ev.source?.groupId ?? ev.source?.roomId ?? "";
  const sourceType = ev.source?.type ?? "user";    // user | group | room
  const pushTarget = groupId || userId;
  const replyToken = ev.replyToken ?? null;

  // Detect if bot was @mentioned (group messages)
  const mentionees = ev.message?.mention?.mentionees ?? [];
  const isMentioned = mentionees.some((m: Record<string, unknown>) => m.isSelf === true);

  // Strip @mention prefix from text, keep only the actual message
  const rawText = ev.message?.text ?? "";
  const text = rawText
    .replace(/^@\S+\s*/g, "")   // remove leading @name
    .trim();

  return {
    ok: true,
    event: {
      sourceType: "line",
      eventType: ev.type ?? "message",
      payload: { userId, groupId, sourceType, pushTarget, text, replyToken, isMentioned, eventType: ev.type ?? "message", raw: ev },
      replyTo: `line://push/${pushTarget}?reply=${replyToken ?? ""}`,
      ts: ev.timestamp ?? Date.now(),
    },
  };
};
