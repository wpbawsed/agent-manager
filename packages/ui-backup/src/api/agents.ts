import { api } from "./auth";

export interface Agent {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  instruction?: string;
  runtimeCmd?: string;
  apiToken: string;
  status: "stopped" | "running" | "error";
  queueId?: string | null;
  createdAt: number;
  updatedAt: number;
  liveStatus?: {
    running: boolean;
    pid?: number;
    uptime?: number;
    restartCount?: number;
    exitCode?: number | null;
  };
}

export interface CreateAgentPayload {
  name: string;
  instruction?: string;
  queueId?: string;
}

export interface UpdateAgentPayload {
  name?: string;
  description?: string;
  instruction?: string;
  runtimeCmd?: string;
  queueId?: string | null;
}

export async function listAgents(): Promise<Agent[]> {
  const res = await api.get<Agent[]>("/agents");
  return res.data;
}

export async function getAgent(id: string): Promise<Agent> {
  const res = await api.get<Agent>(`/agents/${id}`);
  return res.data;
}

export async function createAgent(payload: CreateAgentPayload): Promise<Agent> {
  const res = await api.post<Agent>("/agents", payload);
  return res.data;
}

export async function updateAgent(
  id: string,
  payload: UpdateAgentPayload,
): Promise<Agent> {
  const res = await api.patch<Agent>(`/agents/${id}`, payload);
  return res.data;
}

export async function deleteAgent(id: string): Promise<void> {
  await api.delete(`/agents/${id}`);
}

export async function startAgent(
  id: string,
): Promise<{ ok: boolean; pid?: number }> {
  const res = await api.post<{ ok: boolean; pid?: number }>(
    `/agents/${id}/start`,
    {},
  );
  return res.data;
}

export async function stopAgent(id: string): Promise<{ ok: boolean }> {
  const res = await api.post<{ ok: boolean }>(`/agents/${id}/stop`, {});
  return res.data;
}

// ── Agent file APIs ──────────────────────────────────────────────────────

export async function listDocs(agentId: string): Promise<string[]> {
  const res = await api.get<string[]>(`/agents/${agentId}/docs`);
  return res.data;
}

export async function getDoc(
  agentId: string,
  filename: string,
): Promise<{ filename: string; content: string }> {
  const res = await api.get(`/agents/${agentId}/docs/${filename}`);
  return res.data;
}

export async function putDoc(
  agentId: string,
  filename: string,
  content: string,
): Promise<void> {
  await api.put(`/agents/${agentId}/docs/${filename}`, { content });
}

export async function deleteDoc(
  agentId: string,
  filename: string,
): Promise<void> {
  await api.delete(`/agents/${agentId}/docs/${filename}`);
}

export async function listSkills(agentId: string): Promise<string[]> {
  const res = await api.get<string[]>(`/agents/${agentId}/skills`);
  return res.data;
}

export async function getSkill(
  agentId: string,
  name: string,
): Promise<{ name: string; content: string }> {
  const res = await api.get(`/agents/${agentId}/skills/${name}`);
  return res.data;
}

export async function putSkill(
  agentId: string,
  name: string,
  content: string,
): Promise<void> {
  await api.put(`/agents/${agentId}/skills/${name}`, { content });
}

export async function deleteSkill(
  agentId: string,
  name: string,
): Promise<void> {
  await api.delete(`/agents/${agentId}/skills/${name}`);
}

export async function renameSkill(
  agentId: string,
  oldName: string,
  newName: string,
): Promise<void> {
  await api.patch(`/agents/${agentId}/skills/${encodeURIComponent(oldName)}`, {
    name: newName,
  });
}

// ── Skill file browser ────────────────────────────────────────────────────

export interface SkillFileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: SkillFileEntry[];
}

export async function listSkillFiles(
  agentId: string,
  skillName: string,
): Promise<SkillFileEntry[]> {
  const res = await api.get<SkillFileEntry[]>(
    `/agents/${agentId}/skills/${encodeURIComponent(skillName)}/files`,
  );
  return res.data;
}

export async function getSkillFile(
  agentId: string,
  skillName: string,
  filePath: string,
): Promise<{ path: string; content: string }> {
  const res = await api.get<{ path: string; content: string }>(
    `/agents/${agentId}/skills/${encodeURIComponent(skillName)}/files/${filePath}`,
  );
  return res.data;
}

export async function putSkillFile(
  agentId: string,
  skillName: string,
  filePath: string,
  content: string,
): Promise<void> {
  await api.put(
    `/agents/${agentId}/skills/${encodeURIComponent(skillName)}/files/${filePath}`,
    { content },
  );
}

export async function deleteSkillFile(
  agentId: string,
  skillName: string,
  filePath: string,
): Promise<void> {
  await api.delete(
    `/agents/${agentId}/skills/${encodeURIComponent(skillName)}/files/${filePath}`,
  );
}

export interface Repo {
  name: string;
  path: string;
  description?: string;
}

export async function listRepos(agentId: string): Promise<Repo[]> {
  const res = await api.get<Repo[]>(`/agents/${agentId}/repos`);
  return res.data;
}

export async function putRepos(agentId: string, repos: Repo[]): Promise<void> {
  await api.put(`/agents/${agentId}/repos`, { repos });
}

export interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

export async function getMcpConfig(agentId: string): Promise<McpConfig> {
  const res = await api.get<McpConfig>(`/agents/${agentId}/mcp`);
  return res.data;
}

export async function putMcpConfig(
  agentId: string,
  config: McpConfig,
): Promise<void> {
  await api.put(`/agents/${agentId}/mcp`, config);
}

export async function cloneRepo(
  agentId: string,
  url: string,
  name?: string,
  description?: string,
): Promise<Repo> {
  const res = await api.post<Repo>(`/agents/${agentId}/repos/clone`, {
    url,
    name,
    description,
  });
  return res.data;
}

export async function deleteRepo(agentId: string, name: string): Promise<void> {
  await api.delete(`/agents/${agentId}/repos/${encodeURIComponent(name)}`);
}

export async function getClaudeMd(
  agentId: string,
): Promise<{ content: string }> {
  const res = await api.get(`/agents/${agentId}/claude-md`);
  return res.data;
}

export async function putClaudeMd(
  agentId: string,
  content: string,
): Promise<void> {
  await api.put(`/agents/${agentId}/claude-md`, { content });
}

export async function getVariables(
  agentId: string,
): Promise<Record<string, string>> {
  const res = await api.get(`/agents/${agentId}/variables`);
  return res.data;
}

export async function putVariables(
  agentId: string,
  vars: Record<string, string>,
): Promise<void> {
  await api.put(`/agents/${agentId}/variables`, vars);
}
