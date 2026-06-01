import { createHmac, timingSafeEqual } from "node:crypto";
import type { Normalizer } from "./types.js";

function verifyGitHubSignature(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): boolean {
  const sig = headers["x-hub-signature-256"] as string;
  if (!sig) return false;
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export const githubNormalizer: Normalizer = async (rawBody, headers, config) => {
  if (!verifyGitHubSignature(rawBody, headers, config.GITHUB_WEBHOOK_SECRET ?? config.webhook_secret ?? "")) {
    return { ok: false, status: 401, error: "Invalid GitHub signature" };
  }

  const body =
    typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString("utf-8"));

  const ghEvent = (headers["x-github-event"] as string) ?? "unknown";
  const repo = body.repository?.full_name ?? "";
  const number = body.issue?.number ?? body.pull_request?.number ?? null;
  const action = body.action ?? "";

  return {
    ok: true,
    event: {
      sourceType: "github",
      eventType: `${ghEvent}.${action}`,
      payload: { repo, number, action, raw: body },
      replyTo: number ? `github://${repo}/${number}` : `github://${repo}`,
      ts: Date.now(),
    },
  };
};
