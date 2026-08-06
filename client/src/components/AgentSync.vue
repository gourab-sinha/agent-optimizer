<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AgentAnalysis from './AgentAnalysis.vue'
import AgentMetrics from './AgentMetrics.vue'
import AgentTests from './AgentTests.vue'
import AgentRecommendations from './AgentRecommendations.vue'

const locationId = ref('')
const agents = ref<any[]>([])
const loading = ref(false)
const syncing = ref(false)
const error = ref('')
const lastSync = ref<Date | null>(null)
const expandedAgent = ref<string | null>(null)
const agentCalls = ref<Record<string, any[]>>({})
const loadingCalls = ref<Record<string, boolean>>({})
const syncingCalls = ref<Record<string, boolean>>({})
const agentTabs = ref<Record<string, 'calls' | 'analysis' | 'metrics' | 'tests' | 'recommendations'>>({})

function getAgentTab(agentId: string) {
  return agentTabs.value[agentId] || 'calls'
}

function setAgentTab(agentId: string, tab: 'calls' | 'analysis' | 'metrics' | 'tests' | 'recommendations') {
  agentTabs.value[agentId] = tab
}

// SSO Authentication
async function requestSSOFromParent() {
  return new Promise((resolve, reject) => {
    const messageHandler = async (event: MessageEvent) => {
      if (event.data &&
          (event.data.message === 'REQUEST_USER_DATA_RESPONSE' ||
           event.data.message === 'USER_DATA') &&
          event.data.payload) {
        window.removeEventListener('message', messageHandler)
        try {
          await authenticateWithSSO(event.data.payload)
          resolve(true)
        } catch (err) {
          reject(err)
        }
      }
    }
    window.addEventListener('message', messageHandler)
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')
    setTimeout(() => {
      window.removeEventListener('message', messageHandler)
      reject(new Error('SSO timeout'))
    }, 10000)
  })
}

async function authenticateWithSSO(ssoKey: string) {
  const response = await fetch('/api/oauth/decrypt-sso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: ssoKey })
  })
  if (!response.ok) throw new Error(`SSO decrypt failed: ${response.status}`)
  const data = await response.json()
  if (data.success && data.data?.activeLocation) {
    locationId.value = data.data.activeLocation
    await loadAgents()
  } else {
    error.value = 'Failed to get location ID from SSO data'
  }
}

onMounted(async () => {
  try {
    const urlParams = new URLSearchParams(window.location.search)
    const devLocationId = urlParams.get('locationId')
    const ssoKey = urlParams.get('key') || urlParams.get('ssoKey') || urlParams.get('SSO')

    if (devLocationId) {
      locationId.value = devLocationId
      await loadAgents()
    } else if (ssoKey && ssoKey !== '{{sso_key}}') {
      await authenticateWithSSO(ssoKey)
    } else if (window.parent !== window) {
      await requestSSOFromParent()
    } else {
      error.value = 'No location ID found. Use ?locationId=xxx for testing.'
    }
  } catch (err: any) {
    error.value = `Authentication failed: ${err.message}`
  }
})

async function loadAgents() {
  if (!locationId.value) return
  loading.value = true
  error.value = ''
  try {
    const response = await fetch(`/api/agents/location/${locationId.value}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (data.success) {
      agents.value = data.data
      lastSync.value = new Date()
    }
  } catch (err: any) {
    error.value = `Failed to load agents: ${err.message}`
  } finally {
    loading.value = false
  }
}

async function syncAgents() {
  if (!locationId.value) return
  syncing.value = true
  try {
    const response = await fetch(`/api/agents/sync-location/${locationId.value}`, { method: 'POST' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (data.success) {
      agents.value = data.data
      lastSync.value = new Date()
    }
  } catch (err: any) {
    error.value = `Sync failed: ${err.message}`
  } finally {
    syncing.value = false
  }
}

function toggleAgent(agentId: string) {
  if (expandedAgent.value === agentId) {
    expandedAgent.value = null
  } else {
    expandedAgent.value = agentId
    if (!agentCalls.value[agentId]) loadAgentCalls(agentId)
  }
}

async function loadAgentCalls(agentId: string) {
  loadingCalls.value[agentId] = true
  try {
    const response = await fetch(`/api/calls/agent/${agentId}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (data.success) agentCalls.value[agentId] = data.data
  } finally {
    loadingCalls.value[agentId] = false
  }
}

async function syncAgentCalls(agentId: string) {
  if (!locationId.value) return
  syncingCalls.value[agentId] = true
  try {
    const response = await fetch(`/api/calls/sync-agent/${agentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId: locationId.value })
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (data.success) agentCalls.value[agentId] = data.data
  } finally {
    syncingCalls.value[agentId] = false
  }
}

function formatDate(date: Date | null) {
  if (!date) return 'Never'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date)
}

function formatDuration(seconds: number) {
  if (!seconds) return '0s'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function formatCallDate(dateStr: string) {
  if (!dateStr) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(dateStr))
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Header -->
      <div class="mb-8">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-3xl font-bold text-gray-900">Voice AI Agents</h1>
            <p v-if="lastSync" class="text-sm text-gray-600 mt-2">Last synced: {{ formatDate(lastSync) }}</p>
          </div>
          <button
            @click="syncAgents"
            :disabled="syncing || loading || !locationId"
            class="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
          >
            <svg v-if="syncing" class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <svg v-else class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {{ syncing ? 'Syncing...' : 'Sync Agents' }}
          </button>
        </div>
      </div>

      <!-- Error Alert -->
      <div v-if="error" class="mb-6 bg-white border-l-4 border-red-500 rounded-r-xl p-5 shadow-lg">
        <div class="flex items-start">
          <div class="flex-shrink-0">
            <svg class="h-6 w-6 text-red-500" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
            </svg>
          </div>
          <div class="ml-4">
            <p class="font-medium text-red-800">{{ error }}</p>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-24">
        <div class="text-center">
          <div class="relative">
            <div class="animate-spin h-16 w-16 border-4 border-blue-200 border-t-blue-600 rounded-full mx-auto mb-6"></div>
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="h-8 w-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full"></div>
            </div>
          </div>
          <p class="text-lg font-medium text-gray-700">Loading agents...</p>
        </div>
      </div>

      <!-- Agents Cards -->
      <div v-else-if="agents.length > 0" class="space-y-4">
        <div v-for="agent in agents" :key="agent.id" class="group">
          <!-- Agent Card -->
          <div class="bg-white rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100">
            <div class="p-6">
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-4 flex-1">
                  <button
                    @click="toggleAgent(agent.id)"
                    class="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 transition-all group/btn"
                  >
                    <svg
                      class="w-5 h-5 text-blue-600 transition-transform duration-300"
                      :class="{ 'rotate-90': expandedAgent === agent.id }"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                    </svg>
                  </button>

                  <div class="flex-1 min-w-0">
                    <h3 class="text-lg font-bold text-gray-900 truncate">{{ agent.name }}</h3>
                    <p v-if="agent.business_name" class="text-sm text-gray-500 truncate">{{ agent.business_name }}</p>
                  </div>
                </div>

                <div class="flex items-center space-x-6 ml-6">
                  <div class="hidden lg:flex items-center space-x-6">
                    <div v-if="agent.inbound_number" class="flex items-center space-x-2">
                      <svg class="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      <span class="text-sm font-medium text-gray-600">{{ agent.inbound_number }}</span>
                    </div>

                    <span v-if="agent.language" class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-blue-100 to-indigo-100 text-blue-800 border border-blue-200">
                      {{ agent.language }}
                    </span>

                    <div class="flex items-center space-x-2">
                      <svg class="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span class="text-sm font-medium text-gray-600">{{ agent.config?.actions?.length || 0 }} actions</span>
                    </div>
                  </div>

                  <button
                    @click.stop="syncAgentCalls(agent.id)"
                    :disabled="syncingCalls[agent.id]"
                    class="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
                  >
                    <svg v-if="syncingCalls[agent.id]" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span class="text-sm">{{ syncingCalls[agent.id] ? 'Syncing...' : 'Sync Calls' }}</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Expandable Section with Tabs -->
            <div v-if="expandedAgent === agent.id" class="border-t border-gray-100 bg-gradient-to-br from-slate-50 to-blue-50">
              <div class="p-6">
                <!-- Tab Navigation -->
                <div class="flex gap-2 mb-5">
                  <button
                    @click="setAgentTab(agent.id, 'calls')"
                    :class="[
                      'px-4 py-2 rounded-lg font-medium transition-all text-sm',
                      getAgentTab(agent.id) === 'calls'
                        ? 'bg-white text-blue-600 shadow-md'
                        : 'text-gray-600 hover:bg-white/50'
                    ]"
                  >
                    📞 Call Logs
                  </button>
                  <button
                    @click="setAgentTab(agent.id, 'analysis')"
                    :class="[
                      'px-4 py-2 rounded-lg font-medium transition-all text-sm',
                      getAgentTab(agent.id) === 'analysis'
                        ? 'bg-white text-blue-600 shadow-md'
                        : 'text-gray-600 hover:bg-white/50'
                    ]"
                  >
                    🔍 Analysis
                  </button>
                  <button
                    @click="setAgentTab(agent.id, 'metrics')"
                    :class="[
                      'px-4 py-2 rounded-lg font-medium transition-all text-sm',
                      getAgentTab(agent.id) === 'metrics'
                        ? 'bg-white text-blue-600 shadow-md'
                        : 'text-gray-600 hover:bg-white/50'
                    ]"
                  >
                    📊 Metrics
                  </button>
                  <button
                    @click="setAgentTab(agent.id, 'tests')"
                    :class="[
                      'px-4 py-2 rounded-lg font-medium transition-all text-sm',
                      getAgentTab(agent.id) === 'tests'
                        ? 'bg-white text-blue-600 shadow-md'
                        : 'text-gray-600 hover:bg-white/50'
                    ]"
                  >
                    🧪 Tests
                  </button>
                  <button
                    @click="setAgentTab(agent.id, 'recommendations')"
                    :class="[
                      'px-4 py-2 rounded-lg font-medium transition-all text-sm',
                      getAgentTab(agent.id) === 'recommendations'
                        ? 'bg-white text-blue-600 shadow-md'
                        : 'text-gray-600 hover:bg-white/50'
                    ]"
                  >
                    💡 Recommendations
                  </button>
                </div>

                <!-- Call Logs Tab -->
                <div v-if="getAgentTab(agent.id) === 'calls'">

                <!-- Loading State -->
                <div v-if="loadingCalls[agent.id]" class="flex items-center justify-center py-16">
                  <div class="text-center">
                    <div class="animate-spin h-10 w-10 border-3 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
                    <p class="text-sm font-medium text-gray-600">Loading call logs...</p>
                  </div>
                </div>

                <!-- Call Logs Cards -->
                <div v-else-if="agentCalls[agent.id]?.length" class="space-y-3">
                  <div
                    v-for="call in agentCalls[agent.id]"
                    :key="call.id"
                    class="bg-white rounded-xl p-5 hover:shadow-lg transition-all border border-gray-200 hover:border-blue-200"
                  >
                    <div class="flex items-start justify-between gap-4">
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-gray-900 mb-3 line-clamp-2">
                          {{ call.summary || 'No summary available' }}
                        </p>
                        <div class="flex items-center gap-4 flex-wrap">
                          <span
                            :class="[
                              'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold',
                              call.kind === 'real'
                                ? 'bg-gradient-to-r from-green-100 to-emerald-100 text-green-800 border border-green-200'
                                : 'bg-gradient-to-r from-yellow-100 to-amber-100 text-yellow-800 border border-yellow-200'
                            ]"
                          >
                            {{ call.kind }}
                          </span>
                          <span class="flex items-center gap-1.5 text-xs text-gray-600">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            {{ formatCallDate(call.created_at_ghl) }}
                          </span>
                          <span class="flex items-center gap-1.5 text-xs text-gray-600">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {{ formatDuration(call.duration_s) }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Empty State -->
                <div v-else class="bg-white rounded-xl p-12 text-center border-2 border-dashed border-gray-200">
                  <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                    <svg class="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <h4 class="text-base font-semibold text-gray-900 mb-1">No call logs found</h4>
                  <p class="text-sm text-gray-500">Click "Sync Calls" to fetch from HighLevel</p>
                </div>
                </div>

                <!-- Analysis Tab -->
                <div v-if="getAgentTab(agent.id) === 'analysis'" class="bg-white rounded-xl">
                  <AgentAnalysis
                    :agent-id="agent.id"
                    :agent-name="agent.name"
                    :location-id="locationId"
                  />
                </div>

                <!-- Metrics Tab -->
                <div v-if="getAgentTab(agent.id) === 'metrics'" class="bg-white rounded-xl">
                  <AgentMetrics
                    :agent-id="agent.id"
                    :agent-name="agent.name"
                    :location-id="locationId"
                  />
                </div>

                <!-- Tests Tab -->
                <div v-if="getAgentTab(agent.id) === 'tests'" class="bg-white rounded-xl">
                  <AgentTests
                    :agent-id="agent.id"
                  />
                </div>

                <!-- Recommendations Tab -->
                <div v-if="getAgentTab(agent.id) === 'recommendations'" class="bg-white rounded-xl">
                  <AgentRecommendations
                    :agent-id="agent.id"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="bg-white rounded-2xl shadow-lg p-16 text-center">
        <div class="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center">
          <svg class="w-12 h-12 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <h3 class="text-2xl font-bold text-gray-900 mb-3">No agents found</h3>
        <p class="text-gray-600 mb-8 max-w-md mx-auto">Get started by syncing your agents from HighLevel to see them here</p>
        <button
          @click="syncAgents"
          :disabled="!locationId"
          class="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Sync Agents Now
        </button>
      </div>
    </div>
  </div>
</template>
