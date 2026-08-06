<template>
  <div class="recommendations-container">
    <div class="header-section">
      <h2>Agent Recommendations</h2>
      <button
        @click="generateRecommendations"
        :disabled="loading || generating"
        class="btn-primary"
      >
        {{ generating ? 'Generating...' : 'Generate Recommendations' }}
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading recommendations...</p>
    </div>

    <!-- Error State -->
    <div v-if="error" class="error-banner">
      <p>{{ error }}</p>
    </div>

    <!-- Empty State -->
    <div v-if="!loading && !error && recommendations.length === 0" class="empty-state">
      <p>No recommendations yet.</p>
      <p class="hint">Click "Generate Recommendations" to analyze agent performance and get suggestions.</p>
    </div>

    <!-- Recommendations List -->
    <div v-if="!loading && recommendations.length > 0" class="recommendations-list">
      <div
        v-for="rec in recommendations"
        :key="rec.id"
        class="recommendation-card"
        :class="`tier-${rec.tier}`"
      >
        <div class="card-header">
          <div class="rec-meta">
            <span class="rec-type-badge">{{ formatRecType(rec.recType) }}</span>
            <span class="tier-badge">{{ rec.tier }}</span>
            <span class="status-badge" :class="`status-${rec.status}`">
              {{ rec.status }}
            </span>
          </div>
          <button
            @click="deleteRecommendation(rec.id)"
            class="btn-delete"
            title="Delete recommendation"
          >
            ✕
          </button>
        </div>

        <div class="card-body">
          <p class="rationale">{{ rec.rationale }}</p>

          <!-- Linked Patterns -->
          <div v-if="rec.linkedPatterns && rec.linkedPatterns.length > 0" class="section">
            <h4>Addresses Patterns:</h4>
            <ul class="pattern-list">
              <li v-for="pattern in rec.linkedPatterns" :key="pattern.id">
                <span class="pattern-title">{{ pattern.title }}</span>
                <span class="pattern-criterion">({{ pattern.criterion_key }})</span>
              </li>
            </ul>
          </div>

          <!-- Expected Improvements -->
          <div v-if="rec.expectedCriteria && rec.expectedCriteria.length > 0" class="section">
            <h4>Expected to Improve:</h4>
            <ul class="criteria-list">
              <li v-for="criterion in rec.expectedCriteria" :key="criterion.id">
                {{ criterion.description || criterion.key }}
              </li>
            </ul>
          </div>

          <!-- Payload Preview -->
          <div class="section">
            <h4>Change Details:</h4>
            <div class="payload-preview">
              <pre v-if="rec.recType === 'prompt_patch'">{{ truncatePrompt(rec.payload.newPrompt) }}</pre>
              <pre v-else>{{ JSON.stringify(rec.payload, null, 2) }}</pre>
            </div>
          </div>
        </div>

        <div class="card-footer">
          <small>Created: {{ formatDate(rec.createdAt) }}</small>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const props = defineProps({
  agentId: {
    type: String,
    required: true
  }
})

const loading = ref(false)
const generating = ref(false)
const error = ref(null)
const recommendations = ref([])

// Load recommendations
async function loadRecommendations() {
  loading.value = true
  error.value = null

  try {
    const response = await fetch(`/api/recommendations/agent/${props.agentId}?status=proposed`)
    const data = await response.json()

    if (data.success) {
      recommendations.value = data.recommendations
    } else {
      error.value = data.error || 'Failed to load recommendations'
    }
  } catch (err) {
    error.value = `Error loading recommendations: ${err.message}`
  } finally {
    loading.value = false
  }
}

// Generate new recommendations
async function generateRecommendations() {
  generating.value = true
  error.value = null

  try {
    const response = await fetch(`/api/recommendations/generate/${props.agentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    const data = await response.json()

    if (data.success) {
      // Reload recommendations to show new ones
      await loadRecommendations()
    } else {
      error.value = data.error || 'Failed to generate recommendations'
    }
  } catch (err) {
    error.value = `Error generating recommendations: ${err.message}`
  } finally {
    generating.value = false
  }
}

// Delete a recommendation
async function deleteRecommendation(recommendationId) {
  if (!confirm('Are you sure you want to delete this recommendation?')) {
    return
  }

  try {
    const response = await fetch(`/api/recommendations/${recommendationId}`, {
      method: 'DELETE'
    })

    const data = await response.json()

    if (data.success) {
      // Remove from local state
      recommendations.value = recommendations.value.filter(r => r.id !== recommendationId)
    } else {
      error.value = data.error || 'Failed to delete recommendation'
    }
  } catch (err) {
    error.value = `Error deleting recommendation: ${err.message}`
  }
}

// Format helpers
function formatRecType(recType) {
  return recType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleString()
}

function truncatePrompt(prompt) {
  if (!prompt) return ''
  if (prompt.length <= 300) return prompt
  return prompt.substring(0, 300) + '...\n\n(Click to view full prompt)'
}

// Load on mount
onMounted(() => {
  loadRecommendations()
})
</script>

<style scoped>
.recommendations-container {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.header-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.header-section h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.btn-primary {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-primary:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.loading-state,
.empty-state,
.error-banner {
  text-align: center;
  padding: 48px 24px;
}

.spinner {
  border: 3px solid #f3f4f6;
  border-top: 3px solid #3b82f6;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.error-banner {
  background: #fee2e2;
  border: 1px solid #fca5a5;
  border-radius: 6px;
  color: #991b1b;
  padding: 16px;
}

.empty-state .hint {
  color: #6b7280;
  font-size: 14px;
  margin-top: 8px;
}

.recommendations-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.recommendation-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  transition: box-shadow 0.2s;
}

.recommendation-card:hover {
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.recommendation-card.tier-applicable {
  border-left: 4px solid #10b981;
}

.recommendation-card.tier-advisory {
  border-left: 4px solid #f59e0b;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
}

.rec-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.rec-type-badge,
.tier-badge,
.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.rec-type-badge {
  background: #dbeafe;
  color: #1e40af;
}

.tier-badge {
  background: #d1fae5;
  color: #065f46;
}

.status-badge {
  background: #e5e7eb;
  color: #374151;
}

.status-badge.status-proposed {
  background: #fef3c7;
  color: #92400e;
}

.btn-delete {
  background: none;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  font-size: 20px;
  padding: 4px 8px;
  transition: color 0.2s;
}

.btn-delete:hover {
  color: #ef4444;
}

.card-body {
  padding: 16px;
}

.rationale {
  margin: 0 0 16px 0;
  line-height: 1.6;
  color: #374151;
}

.section {
  margin-top: 16px;
}

.section h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
  color: #6b7280;
}

.pattern-list,
.criteria-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.pattern-list li,
.criteria-list li {
  padding: 6px 0;
  font-size: 14px;
  color: #374151;
}

.pattern-title {
  font-weight: 500;
}

.pattern-criterion {
  color: #6b7280;
  font-size: 12px;
  margin-left: 8px;
}

.payload-preview {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 12px;
  overflow-x: auto;
}

.payload-preview pre {
  margin: 0;
  font-size: 12px;
  font-family: 'Monaco', 'Menlo', monospace;
  color: #374151;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.card-footer {
  padding: 12px 16px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
}

.card-footer small {
  color: #6b7280;
  font-size: 12px;
}
</style>
