<template>
  <span class="badge" :class="cls">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ status: string }>()
const map: Record<string, [string, string]> = {
  running: ['active', '執行中'],
  interrupted: ['waiting', '等待人工'],
  done: ['running', '完成'],
  failed: ['error', '失敗'],
  cancelled: ['stopped', '已取消'],
  // step statuses
  queued: ['stopped', '排隊中'],
}
const cls = computed(() => map[props.status]?.[0] ?? 'stopped')
const label = computed(() => map[props.status]?.[1] ?? props.status)
</script>

<style scoped>
.badge.waiting { background: var(--yellow-bg); color: var(--yellow); }
.badge.waiting::before { background: var(--yellow); }
</style>
