<script setup lang="ts">
import { ref, onMounted } from 'vue'

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

// Request and listen for SSO data from HighLevel parent window
async function requestSSOFromParent() {
  return new Promise((resolve, reject) => {
    const messageHandler = async (event) => {
      console.log('[SSO] Received postMessage:', event.data)

      // HighLevel sends REQUEST_USER_DATA_RESPONSE with encrypted payload
      if (event.data &&
          (event.data.message === 'REQUEST_USER_DATA_RESPONSE' ||
           event.data.message === 'USER_DATA') &&
          event.data.payload) {
        console.log('[SSO] Got SSO response from HighLevel, decrypting...')
        window.removeEventListener('message', messageHandler)

        try {
          await authenticateWithSSO(event.data.payload)
          resolve(true)
        } catch (err) {
          console.error('[SSO] Authentication error:', err)
          reject(err)
        }
      }
    }

    window.addEventListener('message', messageHandler)

    // Request user data from HighLevel parent window
    console.log('[SSO] Sending REQUEST_USER_DATA to parent window')
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')

    // Timeout after 10 seconds
    setTimeout(() => {
      window.removeEventListener('message', messageHandler)
      console.log('[SSO] Timeout - no response from parent window after 10 seconds')
      reject(new Error('SSO timeout'))
    }, 10000)
  })
}

async function authenticateWithSSO(ssoKey: string) {
  try {
    const response = await fetch('/api/oauth/decrypt-sso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: ssoKey })
    })

    if (!response.ok) {
      throw new Error(`SSO decrypt failed: ${response.status}`)
    }

    const data = await response.json()
    console.log('SSO Data:', data)

    if (data.success && data.data?.activeLocation) {
      locationId.value = data.data.activeLocation
      console.log('Location ID:', locationId.value)
      await loadAgents()
    } else {
      error.value = 'Failed to get location ID from SSO data'
      console.error('SSO response:', data)
    }
  } catch (err: any) {
    error.value = `Authentication failed: ${err.message}`
    console.error('SSO error:', err)
  }
}

// Extract location ID from URL (HighLevel's sub-account URL structure)
function extractLocationIdFromUrl() {
  // Check referrer URL first (when loaded in iframe)
  if (document.referrer) {
    console.log('Referrer URL:', document.referrer)
    const referrerMatch = document.referrer.match(/\/location\/([a-zA-Z0-9_-]+)/)
    if (referrerMatch) {
      console.log('Location ID extracted from referrer:', referrerMatch[1])
      return referrerMatch[1]
    }
  }

  // Check current URL
  const urlMatch = window.location.href.match(/\/location\/([a-zA-Z0-9_-]+)/)
  if (urlMatch) {
    console.log('Location ID extracted from current URL:', urlMatch[1])
    return urlMatch[1]
  }

  // Check parent window URL if in iframe
  if (window.parent !== window) {
    try {
      const parentUrl = window.parent.location.href
      console.log('Parent URL:', parentUrl)
      const parentMatch = parentUrl.match(/\/location\/([a-zA-Z0-9_-]+)/)
      if (parentMatch) {
        console.log('Location ID extracted from parent URL:', parentMatch[1])
        return parentMatch[1]
      }
    } catch (e) {
      // Cross-origin iframe - can't access parent URL
      console.log('Cannot access parent URL (cross-origin)')
    }
  }

  return null
}

// Get SSO data from HighLevel
onMounted(async () => {
  try {
    const urlParams = new URLSearchParams(window.location.search)
    const devLocationId = urlParams.get('locationId') // For development testing
    const ssoKey = urlParams.get('key') || urlParams.get('ssoKey') || urlParams.get('SSO')

    console.log('Full URL:', window.location.href)
    console.log('All URL params:', Object.fromEntries(urlParams.entries()))

    // Priority 1: Use explicit locationId parameter (development/testing)
    if (devLocationId) {
      locationId.value = devLocationId
      console.log('[Dev Mode] Using locationId from URL:', locationId.value)
      await loadAgents()
      return
    }

    // Priority 2: Use SSO key from URL if available (production with {{sso_key}})
    if (ssoKey && ssoKey !== '{{sso_key}}') {
      console.log('[SSO] Using SSO key from URL')
      await authenticateWithSSO(ssoKey)
      return
    }

    // Priority 3: Extract location ID from referrer URL
    const extractedLocationId = extractLocationIdFromUrl()
    if (extractedLocationId) {
      locationId.value = extractedLocationId
      console.log('[Referrer] Using extracted location ID:', locationId.value)
      await loadAgents()
      return
    }

    // Priority 4: Request SSO from parent window (iframe mode)
    if (window.parent !== window) {
      console.log('[SSO] Running in iframe, requesting SSO from parent')
      try {
        await requestSSOFromParent()
        return
      } catch (err) {
        console.error('[SSO] Failed to get SSO from parent:', err)
        // Fall through to error
      }
    }

    // Priority 5: Mock data for local development
    if (window.self === window.top) {
      console.warn('[Dev Mode] Not in iframe - using mock location ID')
      locationId.value = 'mock_location_123'
      error.value = 'Using mock data - for testing only. Use ?locationId=xxx for real data.'
      return
    }

    // No authentication method available
    error.value = 'No location ID found. Use ?locationId=xxx for testing.'

  } catch (err: any) {
    error.value = `Authentication failed: ${err.message}`
    console.error('SSO error:', err)
  }
})

async function loadAgents() {
  if (!locationId.value) {
    error.value = 'Location ID not available'
    return
  }

  loading.value = true
  error.value = ''

  try {
    const response = await fetch(`/api/agents/location/${locationId.value}`)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()

    if (data.success) {
      agents.value = data.data
      lastSync.value = new Date()
    } else {
      error.value = data.message || 'Failed to load agents'
    }
  } catch (err: any) {
    error.value = `Failed to load agents: ${err.message}`
    console.error('Load agents error:', err)
  } finally {
    loading.value = false
  }
}

async function syncAgents() {
  if (!locationId.value) {
    error.value = 'Location ID not available. Please refresh the page.'
    return
  }

  syncing.value = true
  error.value = ''

  try {
    const response = await fetch(`/api/agents/sync-location/${locationId.value}`, {
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()

    if (data.success) {
      agents.value = data.data
      lastSync.value = new Date()
    } else {
      error.value = data.message || 'Sync failed'
    }
  } catch (err: any) {
    error.value = `Sync failed: ${err.message}`
    console.error('Sync error:', err)
  } finally {
    syncing.value = false
  }
}

function formatDate(date: Date | null) {
  if (!date) return 'Never'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function toggleAgentCalls(agentId: string) {
  if (expandedAgent.value === agentId) {
    expandedAgent.value = null
  } else {
    expandedAgent.value = agentId
    if (!agentCalls.value[agentId]) {
      loadAgentCalls(agentId)
    }
  }
}

async function loadAgentCalls(agentId: string) {
  loadingCalls.value[agentId] = true

  try {
    const response = await fetch(`/api/calls/agent/${agentId}`)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()

    if (data.success) {
      agentCalls.value[agentId] = data.data
    } else {
      console.error('Failed to load calls:', data.message)
    }
  } catch (err: any) {
    console.error('Load calls error:', err)
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

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()

    if (data.success) {
      agentCalls.value[agentId] = data.data
    } else {
      console.error('Failed to sync calls:', data.message)
    }
  } catch (err: any) {
    console.error('Sync calls error:', err)
  } finally {
    syncingCalls.value[agentId] = false
  }
}

function formatDuration(seconds: number) {
  if (!seconds) return '0s'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function formatCallDate(dateStr: string) {
  if (!dateStr) return 'Unknown'
  const date = new Date(dateStr)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
</script>

<template>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div>
        <h1>Voice AI Agents</h1>
        <p class="subtitle">{{ agents.length }} agent{{ agents.length !== 1 ? 's' : '' }} configured</p>
        <p v-if="locationId" class="debug-info">Location ID: {{ locationId }}</p>
        <p v-else class="debug-info warning">Waiting for authentication...</p>
      </div>
      <button
        @click="syncAgents"
        :disabled="syncing || loading || !locationId"
        class="btn-primary"
      >
        <svg v-if="syncing" class="spinner" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" opacity="0.25"/>
          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" opacity="0.75"/>
        </svg>
        <svg v-else class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {{ syncing ? 'Syncing...' : 'Sync Now' }}
      </button>
    </div>

    <!-- Last sync info -->
    <div v-if="lastSync" class="last-sync">
      Last synced: {{ formatDate(lastSync) }}
    </div>

    <!-- Error message -->
    <div v-if="error" class="error">
      {{ error }}
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="loading">
      <svg class="spinner" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" opacity="0.25"/>
        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" opacity="0.75"/>
      </svg>
      <p>Loading agents...</p>
    </div>

    <!-- Agents list -->
    <div v-else-if="agents.length > 0" class="agents-grid">
      <div v-for="agent in agents" :key="agent.id" class="agent-card">
        <div class="agent-header">
          <h3>{{ agent.name }}</h3>
          <span v-if="agent.language" class="badge">{{ agent.language }}</span>
        </div>

        <div class="agent-details">
          <div v-if="agent.business_name" class="detail">
            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            {{ agent.business_name }}
          </div>

          <div v-if="agent.inbound_number" class="detail">
            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            {{ agent.inbound_number }}
          </div>

          <div v-if="agent.timezone" class="detail">
            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {{ agent.timezone }}
          </div>

          <div v-if="agent.config?.actions?.length" class="detail">
            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {{ agent.config.actions.length }} action{{ agent.config.actions.length !== 1 ? 's' : '' }}
          </div>
        </div>

        <!-- Call Logs Button -->
        <button
          @click="toggleAgentCalls(agent.id)"
          class="calls-toggle"
        >
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
          {{ expandedAgent === agent.id ? 'Hide' : 'View' }} Call Logs
        </button>

        <!-- Expandable Call Logs Section -->
        <div v-if="expandedAgent === agent.id" class="calls-section">
          <div class="calls-header">
            <h4>Call Logs</h4>
            <button
              @click="syncAgentCalls(agent.id)"
              :disabled="syncingCalls[agent.id]"
              class="sync-calls-btn"
            >
              <svg v-if="syncingCalls[agent.id]" class="spinner small" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" opacity="0.25"/>
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" opacity="0.75"/>
              </svg>
              <svg v-else class="icon small" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {{ syncingCalls[agent.id] ? 'Syncing...' : 'Sync' }}
            </button>
          </div>

          <!-- Loading State -->
          <div v-if="loadingCalls[agent.id]" class="calls-loading">
            <svg class="spinner small" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" opacity="0.25"/>
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" opacity="0.75"/>
            </svg>
            <span>Loading calls...</span>
          </div>

          <!-- Calls List -->
          <div v-else-if="agentCalls[agent.id]?.length" class="calls-list">
            <div v-for="call in agentCalls[agent.id].slice(0, 10)" :key="call.id" class="call-item">
              <div class="call-info">
                <div class="call-phone">{{ call.phone_number || 'Unknown' }}</div>
                <div class="call-meta">
                  <span class="call-kind">{{ call.kind }}</span>
                  <span class="call-date">{{ formatCallDate(call.started_at) }}</span>
                  <span class="call-duration">{{ formatDuration(call.duration) }}</span>
                </div>
              </div>
            </div>
            <div v-if="agentCalls[agent.id].length > 10" class="calls-more">
              +{{ agentCalls[agent.id].length - 10 }} more calls
            </div>
          </div>

          <!-- Empty State -->
          <div v-else class="calls-empty">
            <p>No calls found. Click "Sync" to fetch call logs from HighLevel.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="empty-state">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
      <h3>No agents found</h3>
      <p>Click "Sync Now" to fetch your agents from HighLevel</p>
    </div>
  </div>
</template>

<style scoped>
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
  color: #1a202c;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  color: #1a202c;
}

.subtitle {
  font-size: 14px;
  color: #718096;
  margin: 4px 0 0 0;
}

.debug-info {
  font-size: 12px;
  color: #4a5568;
  margin: 4px 0 0 0;
  font-family: monospace;
}

.debug-info.warning {
  color: #d97706;
}

.btn-primary {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #4f46e5;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: #4338ca;
}

.btn-primary:disabled {
  background: #a5b4fc;
  cursor: not-allowed;
}

.icon {
  width: 16px;
  height: 16px;
}

.spinner {
  width: 16px;
  height: 16px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.last-sync {
  font-size: 12px;
  color: #718096;
  margin-bottom: 20px;
}

.error {
  background: #fee;
  border: 1px solid #fcc;
  color: #c33;
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 20px;
  font-size: 14px;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #718096;
}

.loading .spinner {
  width: 32px;
  height: 32px;
  margin-bottom: 16px;
}

.agents-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.agent-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 20px;
  transition: box-shadow 0.2s;
}

.agent-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.agent-header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  margin-bottom: 16px;
}

.agent-header h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: #1a202c;
}

.badge {
  background: #eef2ff;
  color: #4f46e5;
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 12px;
  text-transform: uppercase;
}

.agent-details {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #4a5568;
}

.detail-icon {
  width: 16px;
  height: 16px;
  color: #cbd5e0;
  flex-shrink: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
}

.empty-icon {
  width: 64px;
  height: 64px;
  color: #cbd5e0;
  margin-bottom: 16px;
}

.empty-state h3 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: #1a202c;
}

.empty-state p {
  font-size: 14px;
  color: #718096;
  margin: 0;
}

/* Call Logs Styles */
.calls-toggle {
  width: 100%;
  margin-top: 16px;
  padding: 10px 16px;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #4a5568;
  cursor: pointer;
  transition: all 0.2s;
}

.calls-toggle:hover {
  background: #edf2f7;
  border-color: #cbd5e0;
}

.calls-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
}

.calls-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.calls-header h4 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: #1a202c;
}

.sync-calls-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #4f46e5;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.sync-calls-btn:hover:not(:disabled) {
  background: #4338ca;
}

.sync-calls-btn:disabled {
  background: #a5b4fc;
  cursor: not-allowed;
}

.icon.small {
  width: 12px;
  height: 12px;
}

.spinner.small {
  width: 12px;
  height: 12px;
}

.calls-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: #718096;
  font-size: 13px;
}

.calls-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.call-item {
  padding: 10px;
  background: #f7fafc;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.call-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.call-phone {
  font-size: 14px;
  font-weight: 500;
  color: #1a202c;
}

.call-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #718096;
}

.call-kind {
  padding: 2px 8px;
  background: #eef2ff;
  color: #4f46e5;
  border-radius: 4px;
  font-weight: 500;
  text-transform: capitalize;
}

.calls-more {
  padding: 8px;
  text-align: center;
  font-size: 12px;
  color: #718096;
  font-style: italic;
}

.calls-empty {
  padding: 20px;
  text-align: center;
  color: #718096;
  font-size: 13px;
}

.calls-empty p {
  margin: 0;
}
</style>
