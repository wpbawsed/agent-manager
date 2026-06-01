import { api } from "./auth";

export interface Queue {
  id: string;
  ownerId: string;
  name: string;
  description?: string | null;
  createdAt: number;
}

export interface CreateQueuePayload {
  name: string;
  description?: string;
}

export async function listQueues(): Promise<Queue[]> {
  const res = await api.get<Queue[]>("/queues");
  return res.data;
}

export async function createQueue(payload: CreateQueuePayload): Promise<Queue> {
  const res = await api.post<Queue>("/queues", payload);
  return res.data;
}

export async function deleteQueue(id: string): Promise<void> {
  await api.delete(`/queues/${id}`);
}
