import { api } from "./auth";

export interface RoutingRule {
  id: string;
  ownerId: string;
  name?: string | null;
  brokerId: string;
  queueId: string;
  eventTypes?: string | null;   // JSON string[]
  replyTarget?: string | null;
  createdAt: number;
}

export interface CreateRoutingRulePayload {
  name?: string;
  brokerId: string;
  queueId: string;
  eventTypes?: string[];
  replyTarget?: string;
}

export async function listRoutingRules(): Promise<RoutingRule[]> {
  const res = await api.get<RoutingRule[]>("/routing");
  return res.data;
}

export async function createRoutingRule(
  payload: CreateRoutingRulePayload,
): Promise<RoutingRule> {
  const res = await api.post<RoutingRule>("/routing", payload);
  return res.data;
}

export async function deleteRoutingRule(id: string): Promise<void> {
  await api.delete(`/routing/${id}`);
}
