<template>
  <div class="relative flex w-full flex-col h-screen bg-surface">
    <!-- Google Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">
    
    <!-- Header -->
    <Header :current-tab="currentTab" @change-tab="changeTab" />
    
    <!-- Main Content -->
    <main class="flex-1 flex overflow-hidden">
      <DownloadView v-if="currentTab === 'download'" />
      <HistoryView v-else-if="currentTab === 'history'" />
      <AboutView v-else-if="currentTab === 'about'" />
      <SettingsView v-else-if="currentTab === 'settings'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Header from './components/Header.vue'
import DownloadView from './components/DownloadView.vue'
import HistoryView from './components/HistoryView.vue'
import AboutView from './components/AboutView.vue'
import SettingsView from './components/SettingsView.vue'
import type { TabType } from './types'

const currentTab = ref<TabType>('download')

function changeTab(tab: TabType) {
  currentTab.value = tab
}

// 监听菜单点击关于事件
let unsubscribeMenu: (() => void) | null = null

onMounted(() => {
  if (window.electronAPI?.onMenuShowAbout) {
    unsubscribeMenu = window.electronAPI.onMenuShowAbout(() => {
      currentTab.value = 'about'
    })
  }
})

onUnmounted(() => {
  if (unsubscribeMenu) {
    unsubscribeMenu()
  }
})
</script>

<style>
/* Material Symbols Outlined */
.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}
</style>
