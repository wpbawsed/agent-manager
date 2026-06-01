import { defineStore } from "pinia";
import { ref } from "vue";
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  startAgent,
  stopAgent,
  type Agent,
  type CreateAgentPayload,
  type UpdateAgentPayload,
} from "@/api/agents";

export const useAgentsStore = defineStore("agents", () => {
  const agents = ref<Agent[]>([]);
  const loading = ref(false);

  async function fetchAgents() {
    loading.value = true;
    try {
      agents.value = await listAgents();
    } finally {
      loading.value = false;
    }
  }

  async function fetchAgent(id: string): Promise<Agent> {
    return getAgent(id);
  }

  async function addAgent(payload: CreateAgentPayload): Promise<Agent> {
    const agent = await createAgent(payload);
    agents.value.unshift(agent);
    return agent;
  }

  async function editAgent(
    id: string,
    payload: UpdateAgentPayload,
  ): Promise<Agent> {
    const agent = await updateAgent(id, payload);
    const idx = agents.value.findIndex((a) => a.id === id);
    if (idx !== -1) agents.value[idx] = agent;
    return agent;
  }

  async function removeAgent(id: string) {
    await deleteAgent(id);
    agents.value = agents.value.filter((a) => a.id !== id);
  }

  async function start(id: string) {
    const result = await startAgent(id);
    const idx = agents.value.findIndex((a) => a.id === id);
    if (idx !== -1) agents.value[idx].status = "running";
    return result;
  }

  async function stop(id: string) {
    const result = await stopAgent(id);
    const idx = agents.value.findIndex((a) => a.id === id);
    if (idx !== -1) agents.value[idx].status = "stopped";
    return result;
  }

  return {
    agents,
    loading,
    fetchAgents,
    fetchAgent,
    addAgent,
    editAgent,
    removeAgent,
    start,
    stop,
  };
});
