import { defineStore } from "pinia";
import { ref } from "vue";
import { listQueues, createQueue, deleteQueue, type Queue, type CreateQueuePayload } from "@/api/queues";

export const useQueuesStore = defineStore("queues", () => {
  const queues = ref<Queue[]>([]);
  const loading = ref(false);

  async function fetchQueues() {
    loading.value = true;
    try {
      queues.value = await listQueues();
    } finally {
      loading.value = false;
    }
  }

  async function addQueue(payload: CreateQueuePayload): Promise<Queue> {
    const queue = await createQueue(payload);
    queues.value.unshift(queue);
    return queue;
  }

  async function removeQueue(id: string) {
    await deleteQueue(id);
    queues.value = queues.value.filter((q) => q.id !== id);
  }

  return { queues, loading, fetchQueues, addQueue, removeQueue };
});
