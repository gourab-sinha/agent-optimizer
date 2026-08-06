<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface Props {
  agentId: string
  agentName: string
  locationId: string
}

const props = defineProps<Props>()

// State
const patterns = ref<any[]>([])
const loading = ref(false)
const detecting = ref(false)
const error = ref('')
const rubricId = ref<string | null>(null)

// Load patterns for agent
async function loadPatterns() {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch(`/api/patterns/agent/${props.agentId}`)
    if (!response.ok) throw new Error('Failed to load patterns')

    const data = await response.json()
    if (data.success) {
      patterns.value = data.patterns
    }
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// Get rubric ID for pattern detection
async function getRubricId() {
  try {
    // Get agent version
    const agentResponse = await fetch(`/api/agents/${props.agentId}`)
    if (!agentResponse.ok) throw new Error('Failed to get agent')

    const agentData = await agentResponse.json()
    const versionId = agentData.data?.latestVersionId

    if (!versionId) throw new Error('No agent version found')

    // Get rubric for version
    const rubricResponse = await fetch(`/api/analysis/rubric/${versionId}`)
    if (rubricResponse.status === 404) {
      throw new Error('No rubric found. Generate a rubric in the Analysis tab first.')
    }
    if (!rubricResponse.ok) throw new Error('Failed to get rubric')

    const rubricData = await rubricResponse.json()
    return rubricData.rubric?.id
  } catch (err: any) {
    throw err
  }
}

// Detect patterns
async function detectPatterns() {
  detecting.value = true
  error.value = ''
  try {
    // Get rubric ID
    if (!rubricId.value) {
      rubricId.value = await getRubricId()
    }

    const response = await fetch('/api/patterns/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rubricId: rubricId.value,
        minFailCount: 2,
        minImpactScore: 0.3
      })
    })

    if (!response.ok) throw new Error('Failed to detect patterns')

    const data = await response.json()
    if (data.success) {
      await loadPatterns()
    }
  } catch (err: any) {
    error.value = err.message
  } finally {
    detecting.value = false
  }
}

// Format pattern title for better readability
function formatPatternTitle(title: string) {
  // Convert snake_case or camelCase to readable title
  return title
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

// Get severity badge class
function getSeverityClass(severity: number) {
  if (severity === 3) return 'bg-red-100 text-red-800 border-red-200'
  if (severity === 2) return 'bg-yellow-100 text-yellow-800 border-yellow-200'
  return 'bg-blue-100 text-blue-800 border-blue-200'
}

// Get impact color
function getImpactColor(impact: number) {
  if (impact >= 2) return 'text-red-600'
  if (impact >= 1) return 'text-yellow-600'
  return 'text-blue-600'
}

// Format percentage
function formatPercent(failCount: number, callCount: number) {
  return ((failCount / callCount) * 100).toFixed(1)
}

onMounted(() => {
  loadPatterns()
})
</script>

<template>
  <div class="agent-metrics p-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h3 class="text-lg font-bold text-gray-900">{{ agentName }} - Performance Metrics</h3>
        <p class="text-sm text-gray-500 mt-1">Recurring issues and improvement opportunities</p>
      </div>
      <button
        @click="detectPatterns"
        :disabled="detecting"
        class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
      >
        <span v-if="detecting">🔄 Detecting...</span>
        <span v-else>🔍 Detect Patterns</span>
      </button>
    </div>

    <!-- Error Display -->
    <div v-if="error" class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
      <p class="text-red-800 text-sm">⚠️ {{ error }}</p>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-12">
      <div class="animate-spin h-10 w-10 border-3 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
      <p class="text-sm font-medium text-gray-600">Loading patterns...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="!loading && patterns.length === 0" class="text-center py-12 bg-gray-50 rounded-xl">
      <div class="text-5xl mb-4">📊</div>
      <p class="text-lg font-medium text-gray-900 mb-2">No Patterns Detected Yet</p>
      <p class="text-sm text-gray-500 mb-6">Patterns are automatically identified from call evaluations</p>
      <div class="text-sm text-gray-600 bg-white rounded-lg p-4 max-w-md mx-auto">
        <p class="font-medium mb-2">To detect patterns:</p>
        <ol class="text-left space-y-1">
          <li>1. Go to <strong>Analysis</strong> tab and generate a rubric</li>
          <li>2. Go to <strong>Call Logs</strong> tab and evaluate calls</li>
          <li>3. Click <strong>"Detect Patterns"</strong> above</li>
        </ol>
      </div>
    </div>

    <!-- Patterns List -->
    <div v-else class="space-y-4">
      <!-- Summary Stats -->
      <div class="grid grid-cols-3 gap-4 mb-6">
        <div class="bg-gradient-to-br from-red-50 to-pink-50 rounded-xl p-4 border border-red-100">
          <div class="text-2xl font-bold text-red-600">{{ patterns.length }}</div>
          <div class="text-sm text-red-700">Patterns Found</div>
        </div>
        <div class="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl p-4 border border-yellow-100">
          <div class="text-2xl font-bold text-yellow-600">
            {{ patterns.reduce((sum, p) => sum + p.fail_count, 0) }}
          </div>
          <div class="text-sm text-yellow-700">Total Failures</div>
        </div>
        <div class="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
          <div class="text-2xl font-bold text-blue-600">
            {{ patterns[0]?.call_count || 0 }}
          </div>
          <div class="text-sm text-blue-700">Calls Analyzed</div>
        </div>
      </div>

      <!-- Pattern Cards -->
      <div
        v-for="(pattern, index) in patterns"
        :key="pattern.id"
        class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-lg transition-shadow"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <!-- Pattern Header -->
            <div class="flex items-center gap-3 mb-3">
              <span class="text-2xl font-bold text-gray-400">#{{ index + 1 }}</span>
              <h4 class="text-base font-bold text-gray-900">{{ formatPatternTitle(pattern.title) }}</h4>
            </div>

            <!-- Description -->
            <p class="text-sm text-gray-600 mb-4">{{ pattern.description }}</p>

            <!-- Metrics Row -->
            <div class="flex items-center gap-6 flex-wrap">
              <!-- Impact Score -->
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium text-gray-500">Impact:</span>
                <span :class="['text-lg font-bold', getImpactColor(pattern.impact_score)]">
                  {{ pattern.impact_score.toFixed(2) }}
                </span>
                <span class="text-xs text-gray-400">/3.0</span>
              </div>

              <!-- Severity -->
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium text-gray-500">Severity:</span>
                <span :class="['px-2 py-1 rounded-full text-xs font-semibold border', getSeverityClass(pattern.severity)]">
                  {{ pattern.severity === 3 ? 'Critical' : pattern.severity === 2 ? 'Important' : 'Minor' }}
                </span>
              </div>

              <!-- Failure Rate -->
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium text-gray-500">Failure Rate:</span>
                <span class="text-sm font-bold text-gray-900">
                  {{ formatPercent(pattern.fail_count, pattern.call_count) }}%
                </span>
                <span class="text-xs text-gray-400">({{ pattern.fail_count }}/{{ pattern.call_count }} calls)</span>
              </div>

              <!-- Criterion -->
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium text-gray-500">Criterion:</span>
                <code class="px-2 py-1 bg-gray-100 rounded text-xs font-mono text-gray-700">
                  {{ pattern.criterion_key }}
                </code>
              </div>
            </div>
          </div>

          <!-- Impact Badge -->
          <div class="flex-shrink-0">
            <div
              :class="[
                'w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold border-4',
                pattern.impact_score >= 2
                  ? 'bg-red-50 text-red-600 border-red-200'
                  : pattern.impact_score >= 1
                  ? 'bg-yellow-50 text-yellow-600 border-yellow-200'
                  : 'bg-blue-50 text-blue-600 border-blue-200'
              ]"
            >
              {{ pattern.impact_score.toFixed(1) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-metrics {
  min-height: 400px;
}
</style>
