// Standardized event format passed to every agent via BullMQ
export interface AgentEvent {
  eventId: string;
  brokerId: string;
  sourceType: string; // slack | jira | github | line | railway | notion
  eventType: string;  // e.g. message | issue_opened | push
  payload: Record<string, unknown>;
  replyTo: string;    // reply URI — e.g. slack://C123/1234567890.000
  ts: number;
}

export type NormalizeResult =
  | { ok: true; event: Omit<AgentEvent, "eventId" | "brokerId"> }
  | { ok: false; status: number; error: string };

export type Normalizer = (
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  config: Record<string, string>,
) => Promise<NormalizeResult>;
