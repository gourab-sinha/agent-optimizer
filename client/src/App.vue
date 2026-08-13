<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import AgentSync from './components/AgentSync.vue'
import AgentAnalysis from './components/AgentAnalysis.vue'

interface SelectedAgent {
  id: string
  name: string
  locationId: string
  companyId?: string
}

function cleanAgentName(name: string) {
  if (!name) return ''
  if (name.includes('.') && /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(name)) return ''
  return name
}

const selectedAgent = ref<SelectedAgent | null>(null)
const embedMode = ref(false)
const embedAgent = ref<SelectedAgent | null>(null)

function applyEmbedContext(agent: Partial<SelectedAgent> | null | undefined) {
  if (!agent) return
  const next: SelectedAgent = {
    id: agent.id || embedAgent.value?.id || '',
    name: cleanAgentName(agent.name || '') || embedAgent.value?.name || 'Voice AI Agent',
    locationId: agent.locationId || embedAgent.value?.locationId || '',
    companyId: agent.companyId || embedAgent.value?.companyId || '',
  }
  if (!next.id && !next.locationId) return
  embedMode.value = true
  embedAgent.value = next
  document.documentElement.classList.add('ao-embed')
}

function onParentMessage(event: MessageEvent) {
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'SELECT_AGENT' && data.agent) {
    if (embedMode.value) {
      applyEmbedContext(data.agent)
    } else {
      selectedAgent.value = data.agent
    }
    return
  }
  if (data.type === 'AO_CONTEXT' && data.agent) {
    applyEmbedContext({
      ...data.agent,
      companyId: data.companyId || data.agent.companyId,
    })
  }
}

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const embed = params.get('embed') === '1' || params.get('embed') === 'true'
  const agentId = params.get('agentId') || params.get('agent_id') || ''
  const locationId = params.get('locationId') || params.get('location_id') || ''
  const agentName = params.get('agentName') || params.get('agent_name') || ''
  const companyId = params.get('companyId') || params.get('company_id') || ''
  if (companyId) {
    document.documentElement.dataset.aoCompanyId = companyId
  }
  const selectAgentParam = params.get('selectAgent')

  if (embed || agentId) {
    applyEmbedContext({
      id: agentId,
      name: cleanAgentName(agentName),
      locationId,
      companyId,
    })
  }

  if (selectAgentParam) {
    try {
      const agent = JSON.parse(selectAgentParam)
      if (embed) {
        applyEmbedContext(agent)
      } else {
        selectedAgent.value = agent
      }
    } catch (e) {
      console.error('Failed to parse selectAgent param:', e)
    }
  }

  window.addEventListener('message', onParentMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', onParentMessage)
  document.documentElement.classList.remove('ao-embed')
})

function backToList() {
  selectedAgent.value = null
  window.history.replaceState({}, '', window.location.pathname)
}
</script>

<template>
  <div class="h-full" :class="{ 'ao-embed-shell': embedMode }">
    <AgentSync
      v-if="embedMode || !selectedAgent"
      :embed="embedMode"
      :initial-agent-id="embedAgent?.id || ''"
      :initial-location-id="embedAgent?.locationId || ''"
      :initial-agent-name="embedAgent?.name || ''"
      :initial-company-id="embedAgent?.companyId || ''"
    />
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
