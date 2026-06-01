import { api } from "./auth";
import { API_BASE_URL } from "./config";

export interface AgentLog {
  id: string;
  agentId: string;
  ownerId: string;
  sessionId?: string;
  level: "info" | "error";
  message: string;
  createdAt: number;
}

export async function listAgentLogs(params: {
  agentId?: string;
  limit?: number;
}): Promise<AgentLog[]> {
  const res = await api.get<AgentLog[]>("/logs", { params });
  return res.data;
}

export function createLogStream(agentId: string): EventSource {
  const token = localStorage.getItem("token");
  return new EventSource(
    `${API_BASE_URL}/agents/${agentId}/logs/stream?token=${token}`,
  );
}
