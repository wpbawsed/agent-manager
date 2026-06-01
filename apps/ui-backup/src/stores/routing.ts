import { defineStore } from "pinia";
import { ref } from "vue";
import {
  listRoutingRules,
  createRoutingRule,
  deleteRoutingRule,
  type RoutingRule,
  type CreateRoutingRulePayload,
} from "@/api/routing";

export const useRoutingStore = defineStore("routing", () => {
  const rules = ref<RoutingRule[]>([]);
  const loading = ref(false);

  async function fetchRules() {
    loading.value = true;
    try {
      rules.value = await listRoutingRules();
    } finally {
      loading.value = false;
    }
  }

  async function addRule(payload: CreateRoutingRulePayload): Promise<RoutingRule> {
    const rule = await createRoutingRule(payload);
    rules.value.unshift(rule);
    return rule;
  }

  async function removeRule(id: string) {
    await deleteRoutingRule(id);
    rules.value = rules.value.filter((r) => r.id !== id);
  }

  return { rules, loading, fetchRules, addRule, removeRule };
});
