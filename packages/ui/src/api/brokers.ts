import { api } from "./auth";

export interface BrokerVar {
  key: string;
  label: string;
  placeholder?: string;
  secret: boolean;
  value: string;
}

export interface Broker {
  id: string;
  ownerId: string;
  name: string;
  type: "slack" | "jira" | "notion";
  config: string;
  webhookUrl: string;
  queueId: string | null;
  requiredVars: string | null; // JSON: BrokerVar[]
  status: "active" | "inactive" | "error";
  createdAt: number;
  updatedAt: number;
}

export interface CreateBrokerPayload {
  name: string;
  type: "slack" | "jira" | "notion";
  config: Record<string, string>;
  requiredVars: BrokerVar[];
}

export async function listBrokers(): Promise<Broker[]> {
  const res = await api.get<Broker[]>("/brokers");
  return res.data;
}

export async function getBroker(id: string): Promise<Broker> {
  const res = await api.get<Broker>(`/brokers/${id}`);
  return res.data;
}

export async function createBroker(
  payload: CreateBrokerPayload,
): Promise<Broker> {
  const res = await api.post<Broker>("/brokers", payload);
  return res.data;
}

export async function deleteBroker(id: string): Promise<void> {
  await api.delete(`/brokers/${id}`);
}

export async function activateBroker(id: string): Promise<Broker> {
  const res = await api.post<Broker>(`/brokers/${id}/activate`);
  return res.data;
}

export async function deactivateBroker(id: string): Promise<Broker> {
  const res = await api.post<Broker>(`/brokers/${id}/deactivate`);
  return res.data;
}

export async function updateBroker(
  id: string,
  patch: { name?: string; config?: Record<string, string> },
): Promise<Broker> {
  const res = await api.patch<Broker>(`/brokers/${id}`, patch);
  return res.data;
}
