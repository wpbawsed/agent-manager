import { defineStore } from "pinia";
import { ref } from "vue";
import {
  listBrokers,
  createBroker,
  updateBroker,
  deleteBroker,
  activateBroker,
  deactivateBroker,
  type Broker,
  type CreateBrokerPayload,
} from "@/api/brokers";

export const useBrokersStore = defineStore("brokers", () => {
  const brokers = ref<Broker[]>([]);
  const loading = ref(false);

  async function fetchBrokers() {
    loading.value = true;
    try {
      brokers.value = await listBrokers();
    } finally {
      loading.value = false;
    }
  }

  async function addBroker(payload: CreateBrokerPayload): Promise<Broker> {
    const broker = await createBroker(payload);
    brokers.value.unshift(broker);
    return broker;
  }

  async function removeBroker(id: string) {
    await deleteBroker(id);
    brokers.value = brokers.value.filter((b) => b.id !== id);
  }

  async function activate(id: string) {
    const broker = await activateBroker(id);
    const idx = brokers.value.findIndex((b) => b.id === id);
    if (idx !== -1) brokers.value[idx] = broker;
    return broker;
  }

  async function deactivate(id: string) {
    const broker = await deactivateBroker(id);
    const idx = brokers.value.findIndex((b) => b.id === id);
    if (idx !== -1) brokers.value[idx] = broker;
    return broker;
  }

  async function patchBroker(
    id: string,
    patch: { name?: string; config?: Record<string, string> },
  ) {
    const broker = await updateBroker(id, patch);
    const idx = brokers.value.findIndex((b) => b.id === id);
    if (idx !== -1) brokers.value[idx] = broker;
    return broker;
  }

  return {
    brokers,
    loading,
    fetchBrokers,
    addBroker,
    removeBroker,
    activate,
    deactivate,
    patchBroker,
  };
});
