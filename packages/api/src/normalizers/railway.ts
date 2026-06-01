import { createHmac, timingSafeEqual } from "node:crypto";
import type { Normalizer } from "./types.js";

function verifyRailwaySignature(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): boolean {
  const sig = headers["signature"] as string | undefined;
  if (!sig || !secret) return true;
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export const railwayNormalizer: Normalizer = async (rawBody, headers, config) => {
  if (!verifyRailwaySignature(rawBody, headers, config.RAILWAY_WEBHOOK_SECRET ?? config.webhook_secret ?? "")) {
    return { ok: false, status: 401, error: "Invalid Railway signature" };
  }

  const body =
    typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString("utf-8"));

  const eventType   = body.type ?? "unknown";
  const projectId   = body.resource?.project?.id ?? body.project?.id ?? body.projectId ?? "";
  const projectName = body.resource?.project?.name ?? "";
  const serviceId   = body.resource?.service?.id ?? body.service?.id ?? body.serviceId ?? "";
  const serviceName = body.resource?.service?.name ?? "";
  const environment = body.resource?.environment?.name ?? "";
  const severity    = body.severity ?? "";

  return {
    ok: true,
    event: {
      sourceType: "railway",
      eventType,
      payload: { projectId, projectName, serviceId, serviceName, environment, severity, raw: body },
      replyTo: `railway://${projectId}`,
      ts: Date.now(),
    },
  };
};
