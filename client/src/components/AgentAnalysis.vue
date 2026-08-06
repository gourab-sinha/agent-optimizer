<script setup lang="ts">
import { ref, computed, watch } from 'vue'

interface Props {
  agentId: string
  agentName: string
  locationId: string
}

const props = defineProps<Props>()

// Tabs
const activeTab = ref<'calls' | 'analysis' | 'metrics'>('calls')

// Rubric state
const rubric = ref<any>(null)
const loadingRubric = ref(false)
const generatingRubric = ref(false)

// Calls state
const calls = ref<any[]>([])
const loadingCalls = ref(false)
const selectedCall = ref<string | null>(null)

// Findings state
const findings = ref<any[]>([])
const loadingFindings = ref(false)

// Evaluation state
const evaluating = ref(false)

// Error handling
const error = ref('')

// Get latest agent version
async function getAgentVersion() {
  try {
    const response = await fetch(`/api/agents/${props.agentId}`)
    if (!response.ok) throw new Error('Failed to get agent version')
    const data = await response.json()
    return data.data?.latestVersionId
  } catch (err: any) {
    throw new Error(`Failed to get agent version: ${err.message}`)
  }
}

// Load rubric for agent
async function loadRubric() {
  loadingRubric.value = true
  error.value = ''
  try {
    const versionId = await getAgentVersion()
    if (!versionId) {
      rubric.value = null
      return
    }

    const response = await fetch(`/api/analysis/rubric/${versionId}`)
    if (response.status === 404) {
      rubric.value = null
      return
    }
    if (!response.ok) throw new Error('Failed to load rubric')

    const data = await response.json()
    if (data.success) {
      rubric.value = data.rubric
    }
  } catch (err: any) {
    error.value = err.message
  } finally {
    loadingRubric.value = false
  }
}

// Generate rubric
async function generateRubric() {
  generatingRubric.value = true
  error.value = ''
  try {
    const versionId = await getAgentVersion()
    if (!versionId) throw new Error('No agent version found')

    const response = await fetch('/api/analysis/rubric/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentVersionId: versionId })
    })

    if (!response.ok) throw new Error('Failed to generate rubric')

    const data = await response.json()
    if (data.success) {
      await loadRubric()
    }
  } catch (err: any) {
    error.value = err.message
  } finally {
    generatingRubric.value = false
  }
}

// Load calls
async function loadCalls() {
  loadingCalls.value = true
  error.value = ''
  try {
    const response = await fetch(`/api/calls/agent/${props.agentId}?limit=20`)
    if (!response.ok) throw new Error('Failed to load calls')

    const data = await response.json()
    if (data.success) {
      calls.value = data.data
    }
  } catch (err: any) {
    error.value = err.message
  } finally {
    loadingCalls.value = false
  }
}

// Load findings for a call
async function loadFindings(callId: string) {
  loadingFindings.value = true
  error.value = ''
  try {
    const response = await fetch(`/api/analysis/findings/${callId}`)
    if (!response.ok) throw new Error('Failed to load findings')

    const data = await response.json()
    if (data.success) {
      findings.value = data.findings
    }
  } catch (err: any) {
    error.value = err.message
  } finally {
    loadingFindings.value = false
  }
}

// Evaluate calls
async function evaluateCalls() {
  if (!rubric.value) {
    error.value = 'Please generate rubric first'
    return
  }

  evaluating.value = true
  error.value = ''
  try {
    const callIds = calls.value.map(c => c.id)

    const response = await fetch('/api/analysis/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rubricId: rubric.value.id,
        callIds: callIds
      })
    })

    if (!response.ok) throw new Error('Failed to evaluate calls')

    const data = await response.json()
    if (data.success) {
      // Reload findings for selected call
      if (selectedCall.value) {
        await loadFindings(selectedCall.value)
      }
    }
  } catch (err: any) {
    error.value = err.message
  } finally {
    evaluating.value = false
  }
}

// Select call and load findings
function selectCall(callId: string) {
  selectedCall.value = callId
  loadFindings(callId)
}

// Computed: Group criteria by category
const criteriaByCategory = computed(() => {
  if (!rubric.value?.criteria) return {}

  const grouped: Record<string, any[]> = {}
  for (const criterion of rubric.value.criteria) {
    if (!grouped[criterion.category]) {
      grouped[criterion.category] = []
    }
    grouped[criterion.category].push(criterion)
  }
  return grouped
})

// Computed: Findings summary
const findingsSummary = computed(() => {
  if (!findings.value.length) return null

  const total = findings.value.length
  const passed = findings.value.filter(f => f.status === 'pass').length
  const failed = findings.value.filter(f => f.status === 'fail').length
  const partial = findings.value.filter(f => f.status === 'partial').length
  const na = findings.value.filter(f => f.status === 'na').length

  return {
    total,
    passed,
    failed,
    partial,
    na,
    passRate: ((passed / total) * 100).toFixed(1)
  }
})

// Computed: Group findings by status
const findingsByStatus = computed(() => {
  const grouped: Record<string, any[]> = {
    fail: [],
    pass: [],
    partial: [],
    na: []
  }

  for (const finding of findings.value) {
    if (grouped[finding.status]) {
      grouped[finding.status].push(finding)
    }
  }

  return grouped
})

// Watch tab changes
watch(activeTab, async (newTab) => {
  if (newTab === 'calls' && !calls.value.length) {
    await loadCalls()
  } else if (newTab === 'analysis' && !rubric.value) {
    await loadRubric()
  }
})

// Initial load
loadCalls()
loadRubric()
</script>

<template>
  <div class="agent-analysis">
    <div class="analysis-header">
      <h3 style="margin: 0; font-size: 1.125rem;">{{ agentName }} - Analysis</h3>
    </div>

    <!-- Error Display -->
    <div v-if="error" class="error-banner">
      ⚠️ {{ error }}
      <button @click="error = ''" class="close-btn">×</button>
    </div>

    <!-- Calls Tab -->
    <div v-if="activeTab === 'calls'" class="tab-content">
      <div class="calls-section">
        <div class="section-header">
          <h3>Recent Calls ({{ calls.length }})</h3>
          <div class="actions">
            <button @click="loadCalls" :disabled="loadingCalls" class="btn-secondary">
              {{ loadingCalls ? '⏳ Loading...' : '🔄 Refresh' }}
            </button>
            <button
              v-if="rubric"
              @click="evaluateCalls"
              :disabled="evaluating || !calls.length"
              class="btn-primary"
            >
              {{ evaluating ? '⏳ Evaluating...' : '🎯 Evaluate All' }}
            </button>
          </div>
        </div>

        <div v-if="loadingCalls" class="loading-state">
          <div class="spinner"></div>
          <p>Loading calls...</p>
        </div>

        <div v-else-if="!calls.length" class="empty-state">
          <p>No calls found for this agent</p>
          <button @click="loadCalls" class="btn-secondary">Sync Calls</button>
        </div>

        <div v-else class="calls-grid">
          <div class="calls-list">
            <div
              v-for="call in calls"
              :key="call.id"
              :class="['call-card', { selected: selectedCall === call.id }]"
              @click="selectCall(call.id)"
            >
              <div class="call-header">
                <span class="call-id">{{ call.id.substring(0, 8) }}...</span>
                <span :class="['call-badge', call.kind]">{{ call.kind }}</span>
              </div>
              <div class="call-meta">
                <span>⏱️ {{ call.duration_s }}s</span>
                <span>📅 {{ new Date(call.created_at_ghl).toLocaleDateString() }}</span>
              </div>
              <p v-if="call.summary" class="call-summary">{{ call.summary }}</p>
            </div>
          </div>

          <div class="call-details">
            <div v-if="!selectedCall" class="empty-detail">
              <p>← Select a call to view findings</p>
            </div>

            <div v-else-if="loadingFindings" class="loading-state">
              <div class="spinner"></div>
              <p>Loading findings...</p>
            </div>

            <div v-else-if="!findings.length" class="empty-detail">
              <p>No findings yet</p>
              <button v-if="rubric" @click="evaluateCalls" class="btn-primary">
                Evaluate This Call
              </button>
              <button v-else @click="generateRubric" class="btn-primary">
                Generate Rubric First
              </button>
            </div>

            <div v-else class="findings-display">
              <div class="findings-summary">
                <h4>Evaluation Results</h4>
                <div class="summary-stats">
                  <div class="stat pass">
                    <div class="stat-value">{{ findingsSummary?.passed }}</div>
                    <div class="stat-label">Passed</div>
                  </div>
                  <div class="stat fail">
                    <div class="stat-value">{{ findingsSummary?.failed }}</div>
                    <div class="stat-label">Failed</div>
                  </div>
                  <div class="stat rate">
                    <div class="stat-value">{{ findingsSummary?.passRate }}%</div>
                    <div class="stat-label">Pass Rate</div>
                  </div>
                </div>
              </div>

              <div v-if="findingsByStatus.fail.length" class="findings-group">
                <h4 class="group-header fail">❌ Failures ({{ findingsByStatus.fail.length }})</h4>
                <div
                  v-for="finding in findingsByStatus.fail"
                  :key="finding.id"
                  class="finding-card fail"
                >
                  <div class="finding-header">
                    <span class="finding-key">{{ finding.criterion_key }}</span>
                    <span :class="['severity-badge', `severity-${finding.severity}`]">
                      {{ finding.severity === 3 ? '🔴 Critical' : finding.severity === 2 ? '🟡 Important' : '🟢 Polish' }}
                    </span>
                  </div>
                  <p class="finding-description">{{ finding.description }}</p>
                  <p class="finding-rationale">{{ finding.rationale }}</p>
                  <div class="finding-meta">
                    <span>{{ finding.method }}</span>
                    <span>{{ (finding.confidence * 100).toFixed(0) }}% confident</span>
                  </div>
                </div>
              </div>

              <div v-if="findingsByStatus.pass.length" class="findings-group">
                <h4 class="group-header pass">✅ Passes ({{ findingsByStatus.pass.length }})</h4>
                <div
                  v-for="finding in findingsByStatus.pass.slice(0, 3)"
                  :key="finding.id"
                  class="finding-card pass"
                >
                  <div class="finding-header">
                    <span class="finding-key">{{ finding.criterion_key }}</span>
                  </div>
                  <p class="finding-rationale">{{ finding.rationale }}</p>
                </div>
                <p v-if="findingsByStatus.pass.length > 3" class="more-text">
                  ... and {{ findingsByStatus.pass.length - 3 }} more passes
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Analysis Tab -->
    <div v-if="activeTab === 'analysis'" class="tab-content">
      <div class="analysis-section">
        <div class="section-header">
          <h3>Evaluation Rubric</h3>
          <button
            v-if="!rubric"
            @click="generateRubric"
            :disabled="generatingRubric"
            class="btn-primary"
          >
            {{ generatingRubric ? '⏳ Generating...' : '✨ Generate Rubric' }}
          </button>
          <button v-else @click="loadRubric" :disabled="loadingRubric" class="btn-secondary">
            {{ loadingRubric ? '⏳ Loading...' : '🔄 Refresh' }}
          </button>
        </div>

        <div v-if="loadingRubric" class="loading-state">
          <div class="spinner"></div>
          <p>Loading rubric...</p>
        </div>

        <div v-else-if="!rubric" class="empty-state">
          <p>No rubric generated yet</p>
          <p class="help-text">
            Generate a rubric to automatically create evaluation criteria from your agent's prompt
          </p>
          <button @click="generateRubric" :disabled="generatingRubric" class="btn-primary">
            {{ generatingRubric ? '⏳ Generating...' : '✨ Generate Rubric' }}
          </button>
        </div>

        <div v-else class="rubric-display">
          <div class="rubric-meta">
            <p><strong>Criteria:</strong> {{ rubric.criteria?.length || 0 }}</p>
            <p><strong>Version:</strong> {{ rubric.version }}</p>
            <p><strong>Created:</strong> {{ new Date(rubric.created_at).toLocaleString() }}</p>
          </div>

          <div v-for="(criteria, category) in criteriaByCategory" :key="category" class="category-group">
            <h4 class="category-header">
              {{ category.replace('_', ' ').toUpperCase() }} ({{ criteria.length }})
            </h4>

            <div
              v-for="criterion in criteria"
              :key="criterion.id"
              class="criterion-card"
            >
              <div class="criterion-header">
                <span class="criterion-key">{{ criterion.key }}</span>
                <span :class="['severity-badge', `severity-${criterion.severity}`]">
                  {{ criterion.severity === 3 ? '🔴' : criterion.severity === 2 ? '🟡' : '🟢' }}
                </span>
                <span :class="['check-type-badge', criterion.checkType]">
                  {{ criterion.checkType }}
                </span>
              </div>
              <p class="criterion-description">{{ criterion.description }}</p>
              <div class="criterion-spec">
                <span class="spec-label">Check:</span>
                <code>{{ criterion.checkSpec.kind }}</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Metrics Tab -->
    <div v-if="activeTab === 'metrics'" class="tab-content">
      <div class="metrics-section">
        <h3>Coming Soon</h3>
        <p>Pattern detection and performance metrics will be available here.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-analysis {
  padding: 1rem;
}

.analysis-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e5e7eb;
}

.analysis-header h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #111827;
}

.tab-nav {
  display: flex;
  gap: 0.5rem;
}

.tab-nav button {
  padding: 0.5rem 1rem;
  border: 2px solid #e5e7eb;
  background: white;
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s;
}

.tab-nav button:hover {
  border-color: #3b82f6;
  background: #eff6ff;
}

.tab-nav button.active {
  border-color: #3b82f6;
  background: #3b82f6;
  color: white;
}

.error-banner {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #991b1b;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.section-header h3 {
  margin: 0;
  font-size: 1.25rem;
  color: #111827;
}

.actions {
  display: flex;
  gap: 0.5rem;
}

.btn-primary {
  padding: 0.5rem 1rem;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 0.5rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  background: white;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover:not(:disabled) {
  border-color: #9ca3af;
  background: #f9fafb;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: #6b7280;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.calls-grid {
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 1rem;
}

.calls-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 70vh;
  overflow-y: auto;
}

.call-card {
  padding: 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s;
}

.call-card:hover {
  border-color: #3b82f6;
  background: #eff6ff;
}

.call-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
  border-width: 2px;
}

.call-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.call-id {
  font-family: monospace;
  font-size: 0.875rem;
  color: #6b7280;
}

.call-badge {
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.call-badge.real {
  background: #dcfce7;
  color: #166534;
}

.call-badge.simulated {
  background: #fef3c7;
  color: #92400e;
}

.call-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  color: #6b7280;
  margin-bottom: 0.5rem;
}

.call-summary {
  font-size: 0.875rem;
  color: #374151;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.call-details {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 1rem;
  max-height: 70vh;
  overflow-y: auto;
}

.empty-detail {
  text-align: center;
  padding: 3rem 1rem;
  color: #6b7280;
}

.findings-summary {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.findings-summary h4 {
  margin: 0 0 1rem 0;
  font-size: 1.125rem;
}

.summary-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}

.stat {
  text-align: center;
  padding: 1rem;
  border-radius: 0.5rem;
}

.stat.pass {
  background: #dcfce7;
}

.stat.fail {
  background: #fee2e2;
}

.stat.rate {
  background: #dbeafe;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 0.25rem;
}

.stat.pass .stat-value {
  color: #166534;
}

.stat.fail .stat-value {
  color: #991b1b;
}

.stat.rate .stat-value {
  color: #1e40af;
}

.stat-label {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.findings-group {
  margin-bottom: 1.5rem;
}

.group-header {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
  padding: 0.5rem;
  border-radius: 0.25rem;
}

.group-header.fail {
  background: #fee2e2;
  color: #991b1b;
}

.group-header.pass {
  background: #dcfce7;
  color: #166534;
}

.finding-card {
  padding: 0.75rem;
  border-left: 4px solid;
  margin-bottom: 0.5rem;
  border-radius: 0.25rem;
}

.finding-card.fail {
  background: #fef2f2;
  border-color: #ef4444;
}

.finding-card.pass {
  background: #f0fdf4;
  border-color: #22c55e;
}

.finding-header {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.finding-key {
  font-weight: 600;
  font-size: 0.875rem;
  color: #111827;
}

.severity-badge {
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.severity-badge.severity-3 {
  background: #fee2e2;
  color: #991b1b;
}

.severity-badge.severity-2 {
  background: #fef3c7;
  color: #92400e;
}

.severity-badge.severity-1 {
  background: #dbeafe;
  color: #1e40af;
}

.finding-description {
  font-size: 0.875rem;
  color: #6b7280;
  margin: 0 0 0.5rem 0;
}

.finding-rationale {
  font-size: 0.875rem;
  color: #374151;
  margin: 0 0 0.5rem 0;
}

.finding-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  color: #6b7280;
}

.more-text {
  text-align: center;
  color: #6b7280;
  font-size: 0.875rem;
  font-style: italic;
}

.rubric-meta {
  background: #f9fafb;
  padding: 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1.5rem;
  display: flex;
  gap: 2rem;
}

.rubric-meta p {
  margin: 0;
  font-size: 0.875rem;
  color: #374151;
}

.category-group {
  margin-bottom: 1.5rem;
}

.category-header {
  font-size: 1rem;
  font-weight: 600;
  color: #111827;
  margin-bottom: 0.75rem;
  padding: 0.5rem;
  background: #f3f4f6;
  border-radius: 0.25rem;
}

.criterion-card {
  padding: 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  margin-bottom: 0.5rem;
}

.criterion-header {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.criterion-key {
  font-weight: 600;
  font-size: 0.875rem;
  color: #111827;
}

.check-type-badge {
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.check-type-badge.deterministic {
  background: #dbeafe;
  color: #1e40af;
}

.check-type-badge.llm {
  background: #fce7f3;
  color: #9f1239;
}

.criterion-description {
  font-size: 0.875rem;
  color: #374151;
  margin: 0 0 0.5rem 0;
}

.criterion-spec {
  font-size: 0.75rem;
  color: #6b7280;
}

.spec-label {
  font-weight: 500;
  margin-right: 0.25rem;
}

.help-text {
  color: #6b7280;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}
</style>
