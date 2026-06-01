<template>
  <n-config-provider :theme="darkTheme">
    <n-global-style />
    <n-message-provider>
      <n-dialog-provider>
        <router-view />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { NConfigProvider, NGlobalStyle, NMessageProvider, NDialogProvider, darkTheme } from 'naive-ui'
</script>
