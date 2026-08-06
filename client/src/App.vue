<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AgentSync from './components/AgentSync.vue'
import AgentAnalysis from './components/AgentAnalysis.vue'

interface SelectedAgent {
  id: string
  name: string
  locationId: string
}

const selectedAgent = ref<SelectedAgent | null>(null)

// Check URL params for direct agent selection
onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const selectAgentParam = params.get('selectAgent')

  if (selectAgentParam) {
    try {
      const agent = JSON.parse(selectAgentParam)
      selectedAgent.value = agent
    } catch (e) {
      console.error('Failed to parse selectAgent param:', e)
    }
  }
})

// Listen for agent selection events from window
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SELECT_AGENT') {
    selectedAgent.value = event.data.agent
  }
})

function backToList() {
  selectedAgent.value = null
  // Clear URL params
  window.history.replaceState({}, '', window.location.pathname)
}
</script>

<template>
  <div>
    <div v-if="!selectedAgent">
      <AgentSync />
    </div>
    <div v-else class="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button
          @click="backToList"
          class="mb-4 inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors shadow-sm"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Agents
        </button>
        <AgentAnalysis
          :agent-id="selectedAgent.id"
          :agent-name="selectedAgent.name"
          :location-id="selectedAgent.locationId"
        />
      </div>
    </div>
  </div>
</template>
