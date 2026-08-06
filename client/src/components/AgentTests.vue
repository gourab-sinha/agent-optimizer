<template>
  <div class="test-cases-container">
    <!-- Header with actions -->
    <div class="test-header">
      <div class="header-info">
        <h3>Test Cases</h3>
        <p class="subtitle">Automated testing for agent performance validation</p>
      </div>
      <div class="header-actions">
        <button
          @click="generateTestCases"
          :disabled="generating"
          class="btn btn-secondary"
        >
          {{ generating ? 'Generating...' : '🧪 Generate Test Cases' }}
        </button>
        <button
          @click="runTests"
          :disabled="running || testCases.length === 0"
          class="btn btn-primary"
        >
          {{ running ? 'Running Tests...' : '▶️ Run All Tests' }}
        </button>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading test cases...</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="testCases.length === 0 && !loading" class="empty-state">
      <div class="empty-icon">🧪</div>
      <h3>No Test Cases Yet</h3>
      <p>Generate test cases to start automated testing of your agent</p>
      <button @click="generateTestCases" :disabled="generating" class="btn btn-primary">
        {{ generating ? 'Generating...' : 'Generate Test Cases' }}
      </button>
    </div>

    <!-- Test cases content -->
    <div v-else class="test-content">
      <!-- Summary stats -->
      <div class="test-stats">
        <div class="stat-card">
          <div class="stat-value">{{ testCases.length }}</div>
          <div class="stat-label">Total Test Cases</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ happyPathCount }}</div>
          <div class="stat-label">Happy Path</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ edgeCaseCount }}</div>
          <div class="stat-label">Edge Cases</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" :class="testsRunCount > 0 ? 'success' : ''">{{ testsRunCount }}</div>
          <div class="stat-label">Tests Run</div>
        </div>
        <div class="stat-card" v-if="testsNotRunCount > 0">
          <div class="stat-value warning">{{ testsNotRunCount }}</div>
          <div class="stat-label">Not Run Yet</div>
        </div>
        <div class="stat-card" v-if="latestRun">
          <div class="stat-value" :class="getPassRateClass(latestRun.pass_rate)">
            {{ latestRun.pass_rate }}%
          </div>
          <div class="stat-label">Latest Pass Rate</div>
        </div>
      </div>

      <!-- Test run history -->
      <div v-if="testRuns.length > 0" class="test-runs-section">
        <h4>Recent Test Runs</h4>
        <div class="test-runs-list">
          <div
            v-for="run in testRuns"
            :key="run.id"
            class="test-run-card"
            @click="viewTestRunResults(run.id)"
          >
            <div class="run-header">
              <div class="run-info">
                <span class="run-date">{{ formatDate(run.created_at) }}</span>
                <span class="run-trigger">{{ run.trigger }}</span>
              </div>
              <div class="run-status" :class="run.status">{{ run.status }}</div>
            </div>
            <div class="run-stats">
              <div class="run-stat">
                <span class="stat-label">Tests:</span>
                <span class="stat-value">{{ run.total_tests || 0 }}</span>
              </div>
              <div class="run-stat">
                <span class="stat-label">Passed:</span>
                <span class="stat-value success">{{ run.passed_tests || 0 }}</span>
              </div>
              <div class="run-stat">
                <span class="stat-label">Failed:</span>
                <span class="stat-value error">{{ run.failed_tests || 0 }}</span>
              </div>
              <div class="run-stat">
                <span class="stat-label">Pass Rate:</span>
                <span class="stat-value" :class="getPassRateClass(calculatePassRate(run))">
                  {{ calculatePassRate(run) }}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Test cases list -->
      <div class="test-cases-section">
        <div class="section-header">
          <div class="section-title-row">
            <h4>Test Cases</h4>
            <div class="selection-controls">
              <button
                @click="toggleSelectAll"
                class="select-all-btn"
                v-if="filteredUnrunTests.length > 0"
              >
                {{ allFilteredUnrunSelected ? 'Deselect All' : 'Select All' }}
              </button>
              <button
                v-if="selectedTests.length > 0"
                @click="runSelectedTests"
                :disabled="running"
                class="run-selected-btn"
              >
                {{ running ? 'Running...' : `▶️ Run Selected (${selectedTests.length})` }}
              </button>
              <span v-if="selectedTests.length > 0" class="selection-count">
                {{ selectedTests.length }} selected
              </span>
            </div>
          </div>
          <div class="filter-buttons">
            <button
              @click="filterKind = 'all'"
              :class="{ active: filterKind === 'all' }"
              class="filter-btn"
            >
              All ({{ testCases.length }})
            </button>
            <button
              @click="filterKind = 'happy_path'"
              :class="{ active: filterKind === 'happy_path' }"
              class="filter-btn"
            >
              Happy Path ({{ happyPathCount }})
            </button>
            <button
              @click="filterKind = 'edge_case'"
              :class="{ active: filterKind === 'edge_case' }"
              class="filter-btn"
            >
              Edge Cases ({{ edgeCaseCount }})
            </button>
          </div>
        </div>

        <div class="test-cases-list">
          <div
            v-for="testCase in filteredTestCases"
            :key="testCase.id"
            class="test-case-card"
          >
            <div class="test-case-header">
              <div class="test-case-title">
                <input
                  type="checkbox"
                  :checked="selectedTests.includes(testCase.id)"
                  @change="toggleTestSelection(testCase.id)"
                  @click.stop
                  :disabled="testCaseResults[testCase.id] !== undefined"
                  class="test-checkbox"
                />
                <span class="test-kind-badge" :class="testCase.kind">
                  {{ testCase.kind === 'happy_path' ? '✓ Happy Path' : '⚠️ Edge Case' }}
                </span>
                <h5>{{ testCase.title }}</h5>
                <span v-if="testCaseResults[testCase.id]" class="test-status-badge" :class="{ passed: testCaseResults[testCase.id].passed }">
                  {{ testCaseResults[testCase.id].passed ? '✓ Passed' : '✗ Failed' }}
                </span>
                <span v-else class="test-status-badge not-run">
                  ⊘ Not Run
                </span>
              </div>
              <div class="test-case-actions">
                <button
                  @click.stop="runSingleTest(testCase.id)"
                  :disabled="runningTests[testCase.id] || running"
                  class="run-test-btn"
                >
                  {{ runningTests[testCase.id] ? '⏳ Running...' : '▶️ Run Test' }}
                </button>
                <button @click="toggleTestCase(testCase.id)" class="expand-btn">
                  {{ expandedTests.includes(testCase.id) ? '▼' : '▶' }}
                </button>
              </div>
            </div>

            <div v-if="expandedTests.includes(testCase.id)" class="test-case-details">
              <!-- Persona -->
              <div class="detail-section">
                <h6>👤 Caller Persona</h6>
                <div class="persona-info">
                  <p><strong>Name:</strong> {{ getPersona(testCase).name }}</p>
                  <p v-if="getPersona(testCase).age">
                    <strong>Age:</strong> {{ getPersona(testCase).age }}
                  </p>
                  <p v-if="getPersona(testCase).occupation">
                    <strong>Occupation:</strong> {{ getPersona(testCase).occupation }}
                  </p>
                  <p v-if="getPersona(testCase).communication_style">
                    <strong>Style:</strong> {{ getPersona(testCase).communication_style }}
                  </p>
                  <p v-if="getPersona(testCase).challenge" class="challenge">
                    <strong>Challenge:</strong> {{ getPersona(testCase).challenge }}
                  </p>
                </div>
              </div>

              <!-- Scenario -->
              <div class="detail-section">
                <h6>📋 Scenario</h6>
                <p class="scenario-text">{{ testCase.scenario }}</p>
              </div>

              <!-- Pattern (for edge cases) -->
              <div v-if="testCase.pattern_title" class="detail-section">
                <h6>🎯 Tests Pattern</h6>
                <p class="pattern-text">{{ testCase.pattern_title }}</p>
              </div>

              <!-- Metadata -->
              <div class="detail-section metadata">
                <p><strong>Created:</strong> {{ formatDate(testCase.created_at) }}</p>
                <p v-if="testCase.criterion_ids">
                  <strong>Criteria:</strong> {{ testCase.criterion_ids.length }} criteria
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Test results modal -->
    <div v-if="showResultsModal" class="modal-overlay" @click="closeResultsModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>Test Run Results</h3>
          <button @click="closeResultsModal" class="close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <div v-if="loadingResults" class="loading-state">
            <div class="spinner"></div>
            <p>Loading results...</p>
          </div>
          <div v-else-if="currentResults.length > 0">
            <div class="results-summary">
              <div class="summary-stat">
                <span class="label">Total Tests:</span>
                <span class="value">{{ currentResults.length }}</span>
              </div>
              <div class="summary-stat">
                <span class="label">Passed:</span>
                <span class="value success">{{ passedCount }}</span>
              </div>
              <div class="summary-stat">
                <span class="label">Failed:</span>
                <span class="value error">{{ failedCount }}</span>
              </div>
              <div class="summary-stat">
                <span class="label">Pass Rate:</span>
                <span class="value" :class="getPassRateClass(passRate)">{{ passRate }}%</span>
              </div>
            </div>

            <div class="results-list">
              <div
                v-for="result in currentResults"
                :key="result.id"
                class="result-card"
              >
                <div class="result-header">
                  <div class="result-title">
                    <span class="result-status" :class="{ passed: result.passed }">
                      {{ result.passed ? '✓' : '✗' }}
                    </span>
                    <span>{{ result.test_case_title }}</span>
                    <span class="attempt-badge">Attempt {{ result.attempt }}</span>
                  </div>
                  <span class="test-kind-badge" :class="result.test_case_kind">
                    {{ result.test_case_kind === 'happy_path' ? 'Happy Path' : 'Edge Case' }}
                  </span>
                </div>

                <div v-if="result.criterion_outcomes" class="criterion-outcomes">
                  <h6>Criterion Evaluations:</h6>
                  <div
                    v-for="(outcome, criterionId) in parseCriterionOutcomes(result.criterion_outcomes)"
                    :key="criterionId"
                    class="outcome-item"
                  >
                    <div class="outcome-header">
                      <span class="outcome-status" :class="outcome.status">
                        {{ outcome.status === 'pass' ? '✓' : '✗' }}
                      </span>
                      <span class="confidence">
                        {{ Math.round(outcome.confidence * 100) }}% confidence
                      </span>
                    </div>
                    <p class="rationale">{{ outcome.rationale }}</p>
                    <p v-if="outcome.evidence" class="evidence">
                      <strong>Evidence:</strong> {{ outcome.evidence }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'AgentTests',
  props: {
    agentId: {
      type: String,
      required: true
    }
  },
  data() {
    return {
      loading: false,
      generating: false,
      running: false,
      runningTests: {}, // Map of testCaseId -> boolean (for individual test runs)
      selectedTests: [], // Array of selected test case IDs
      testCases: [],
      testRuns: [],
      testCaseResults: {}, // Map of testCaseId -> latest result
      filterKind: 'all',
      expandedTests: [],
      showResultsModal: false,
      loadingResults: false,
      currentResults: [],
      currentRunId: null
    }
  },
  computed: {
    filteredTestCases() {
      if (this.filterKind === 'all') {
        return this.testCases
      }
      return this.testCases.filter(tc => tc.kind === this.filterKind)
    },
    happyPathCount() {
      return this.testCases.filter(tc => tc.kind === 'happy_path').length
    },
    edgeCaseCount() {
      return this.testCases.filter(tc => tc.kind === 'edge_case').length
    },
    testsRunCount() {
      return Object.keys(this.testCaseResults).length
    },
    testsNotRunCount() {
      return this.testCases.length - this.testsRunCount
    },
    latestRun() {
      if (this.testRuns.length === 0) return null
      const run = this.testRuns[0]
      return {
        ...run,
        pass_rate: this.calculatePassRate(run)
      }
    },
    passedCount() {
      return this.currentResults.filter(r => r.passed).length
    },
    failedCount() {
      return this.currentResults.filter(r => !r.passed).length
    },
    passRate() {
      if (this.currentResults.length === 0) return 0
      return Math.round((this.passedCount / this.currentResults.length) * 100)
    },
    filteredUnrunTests() {
      return this.filteredTestCases.filter(tc => !this.testCaseResults[tc.id])
    },
    allFilteredUnrunSelected() {
      if (this.filteredUnrunTests.length === 0) return false
      return this.filteredUnrunTests.every(tc => this.selectedTests.includes(tc.id))
    }
  },
  mounted() {
    this.loadTestCases()
    this.loadTestRuns()
  },
  methods: {
    async loadTestCases() {
      this.loading = true
      try {
        const response = await fetch(`/api/tests/agent/${this.agentId}`)
        const data = await response.json()
        if (data.success) {
          this.testCases = data.testCases
        }
      } catch (error) {
        console.error('Failed to load test cases:', error)
      } finally {
        this.loading = false
      }
    },

    async loadTestRuns() {
      try {
        const response = await fetch(`/api/tests/agent/${this.agentId}/runs?limit=5`)
        const data = await response.json()
        if (data.success) {
          this.testRuns = data.runs
          // Load latest results for each test case
          if (data.runs.length > 0) {
            await this.loadLatestTestResults(data.runs[0].id)
          }
        }
      } catch (error) {
        console.error('Failed to load test runs:', error)
      }
    },

    async loadLatestTestResults(runId) {
      try {
        const response = await fetch(`/api/tests/runs/${runId}/results`)
        const data = await response.json()
        if (data.success) {
          // Map results by test case ID (use latest attempt)
          const resultsMap = {}
          data.results.forEach(result => {
            if (!resultsMap[result.test_case_id] || result.attempt > resultsMap[result.test_case_id].attempt) {
              resultsMap[result.test_case_id] = result
            }
          })
          this.testCaseResults = resultsMap
        }
      } catch (error) {
        console.error('Failed to load latest results:', error)
      }
    },

    async generateTestCases() {
      this.generating = true
      try {
        const response = await fetch('/api/tests/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: this.agentId,
            happyPathCount: 2,
            edgeCaseCount: 1
          })
        })
        const data = await response.json()
        if (data.success) {
          await this.loadTestCases()
          this.$emit('notification', {
            type: 'success',
            message: `Generated ${data.totalCases} test cases`
          })
        } else {
          throw new Error(data.error)
        }
      } catch (error) {
        console.error('Failed to generate test cases:', error)
        this.$emit('notification', {
          type: 'error',
          message: 'Failed to generate test cases'
        })
      } finally {
        this.generating = false
      }
    },

    async runTests() {
      this.running = true
      try {
        const response = await fetch('/api/tests/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: this.agentId,
            runsPerCase: 2,
            trigger: 'manual'
          })
        })
        const data = await response.json()
        if (data.success) {
          await this.loadTestRuns()
          // Reload latest results for the test cases
          await this.loadLatestTestResults(data.testRunId)
          this.$emit('notification', {
            type: 'success',
            message: `Test run complete: ${data.passRate}% pass rate`
          })
          // Auto-open results
          this.viewTestRunResults(data.testRunId)
        } else {
          throw new Error(data.error)
        }
      } catch (error) {
        console.error('Failed to run tests:', error)
        this.$emit('notification', {
          type: 'error',
          message: 'Failed to run tests'
        })
      } finally {
        this.running = false
      }
    },

    async runSingleTest(testCaseId) {
      this.runningTests[testCaseId] = true
      try {
        const response = await fetch('/api/tests/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: this.agentId,
            testCaseIds: [testCaseId],
            runsPerCase: 2,
            trigger: 'manual'
          })
        })
        const data = await response.json()
        if (data.success) {
          await this.loadTestRuns()
          // Reload latest results for the test cases
          await this.loadLatestTestResults(data.testRunId)
          this.$emit('notification', {
            type: 'success',
            message: `Test complete: ${data.passRate}% pass rate`
          })
          // Auto-open results
          this.viewTestRunResults(data.testRunId)
        } else {
          throw new Error(data.error)
        }
      } catch (error) {
        console.error('Failed to run test:', error)
        this.$emit('notification', {
          type: 'error',
          message: 'Failed to run test'
        })
      } finally {
        this.runningTests[testCaseId] = false
      }
    },

    async runSelectedTests() {
      if (this.selectedTests.length === 0) return

      this.running = true
      try {
        const response = await fetch('/api/tests/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: this.agentId,
            testCaseIds: this.selectedTests,
            runsPerCase: 2,
            trigger: 'manual'
          })
        })
        const data = await response.json()
        if (data.success) {
          await this.loadTestRuns()
          // Reload latest results for the test cases
          await this.loadLatestTestResults(data.testRunId)
          this.$emit('notification', {
            type: 'success',
            message: `Test run complete: ${data.passRate}% pass rate`
          })
          // Auto-open results
          this.viewTestRunResults(data.testRunId)
          // Clear selection after successful run
          this.selectedTests = []
        } else {
          throw new Error(data.error)
        }
      } catch (error) {
        console.error('Failed to run selected tests:', error)
        this.$emit('notification', {
          type: 'error',
          message: 'Failed to run selected tests'
        })
      } finally {
        this.running = false
      }
    },

    toggleTestSelection(testCaseId) {
      const index = this.selectedTests.indexOf(testCaseId)
      if (index > -1) {
        this.selectedTests.splice(index, 1)
      } else {
        this.selectedTests.push(testCaseId)
      }
    },

    toggleSelectAll() {
      if (this.allFilteredUnrunSelected) {
        // Deselect all filtered unrun tests
        const unrunIds = this.filteredUnrunTests.map(tc => tc.id)
        this.selectedTests = this.selectedTests.filter(id => !unrunIds.includes(id))
      } else {
        // Select all filtered unrun tests
        const unrunIds = this.filteredUnrunTests.map(tc => tc.id)
        const newSelections = unrunIds.filter(id => !this.selectedTests.includes(id))
        this.selectedTests.push(...newSelections)
      }
    },

    async viewTestRunResults(runId) {
      this.currentRunId = runId
      this.showResultsModal = true
      this.loadingResults = true
      try {
        const response = await fetch(`/api/tests/runs/${runId}/results`)
        const data = await response.json()
        if (data.success) {
          this.currentResults = data.results
        }
      } catch (error) {
        console.error('Failed to load results:', error)
      } finally {
        this.loadingResults = false
      }
    },

    closeResultsModal() {
      this.showResultsModal = false
      this.currentResults = []
      this.currentRunId = null
    },

    toggleTestCase(testCaseId) {
      const index = this.expandedTests.indexOf(testCaseId)
      if (index > -1) {
        this.expandedTests.splice(index, 1)
      } else {
        this.expandedTests.push(testCaseId)
      }
    },

    getPersona(testCase) {
      if (typeof testCase.persona === 'string') {
        try {
          return JSON.parse(testCase.persona)
        } catch {
          return {}
        }
      }
      return testCase.persona || {}
    },

    parseCriterionOutcomes(outcomes) {
      if (typeof outcomes === 'string') {
        try {
          return JSON.parse(outcomes)
        } catch {
          return {}
        }
      }
      return outcomes || {}
    },

    calculatePassRate(run) {
      if (!run.total_tests || run.total_tests === 0) return 0
      return Math.round((run.passed_tests / run.total_tests) * 100)
    },

    getPassRateClass(rate) {
      if (rate >= 80) return 'success'
      if (rate >= 50) return 'warning'
      return 'error'
    },

    formatDate(dateString) {
      return new Date(dateString).toLocaleString()
    }
  }
}
</script>

<style scoped>
.test-cases-container {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.test-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
}

.header-info h3 {
  margin: 0 0 4px 0;
  font-size: 24px;
  font-weight: 600;
  color: #1a1a1a;
}

.subtitle {
  margin: 0;
  color: #666;
  font-size: 14px;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.btn {
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #2563eb;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-secondary {
  background: #f3f4f6;
  color: #374151;
}

.btn-secondary:hover:not(:disabled) {
  background: #e5e7eb;
}

.loading-state {
  text-align: center;
  padding: 60px 20px;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f4f6;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  text-align: center;
  padding: 80px 20px;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.empty-state h3 {
  margin: 0 0 8px 0;
  color: #1a1a1a;
}

.empty-state p {
  margin: 0 0 24px 0;
  color: #666;
}

.test-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.stat-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 20px;
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  color: #1a1a1a;
  margin-bottom: 4px;
}

.stat-value.success {
  color: #10b981;
}

.stat-value.warning {
  color: #f59e0b;
}

.stat-value.error {
  color: #ef4444;
}

.stat-label {
  font-size: 14px;
  color: #666;
}

.test-runs-section,
.test-cases-section {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
}

.test-runs-section h4,
.section-header h4 {
  margin: 0 0 20px 0;
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}

.test-runs-list {
  display: grid;
  gap: 12px;
}

.test-run-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.test-run-card:hover {
  border-color: #2563eb;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.1);
}

.run-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.run-info {
  display: flex;
  gap: 12px;
  align-items: center;
}

.run-date {
  font-size: 14px;
  color: #374151;
  font-weight: 500;
}

.run-trigger {
  font-size: 12px;
  color: #6b7280;
  background: white;
  padding: 2px 8px;
  border-radius: 4px;
}

.run-status {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 12px;
  font-weight: 500;
  text-transform: capitalize;
}

.run-status.completed {
  background: #d1fae5;
  color: #065f46;
}

.run-status.running {
  background: #dbeafe;
  color: #1e40af;
}

.run-stats {
  display: flex;
  gap: 24px;
}

.run-stat {
  display: flex;
  gap: 6px;
  font-size: 14px;
}

.run-stat .stat-label {
  color: #6b7280;
}

.run-stat .stat-value {
  font-weight: 600;
  color: #1a1a1a;
}

.run-stat .stat-value.success {
  color: #10b981;
}

.run-stat .stat-value.error {
  color: #ef4444;
}

.section-header {
  margin-bottom: 20px;
}

.section-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-title-row h4 {
  margin: 0;
}

.selection-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.select-all-btn {
  padding: 6px 14px;
  border: 1px solid #e5e7eb;
  background: white;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
}

.select-all-btn:hover {
  border-color: #2563eb;
  background: #f9fafb;
}

.run-selected-btn {
  padding: 6px 14px;
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
  white-space: nowrap;
}

.run-selected-btn:hover:not(:disabled) {
  background: #1d4ed8;
}

.run-selected-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.selection-count {
  font-size: 13px;
  color: #2563eb;
  font-weight: 500;
}

.filter-buttons {
  display: flex;
  gap: 8px;
}

.filter-btn {
  padding: 6px 14px;
  border: 1px solid #e5e7eb;
  background: white;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-btn:hover {
  border-color: #2563eb;
}

.filter-btn.active {
  background: #2563eb;
  color: white;
  border-color: #2563eb;
}

.test-cases-list {
  display: grid;
  gap: 12px;
}

.test-case-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.test-case-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  cursor: pointer;
}

.test-case-header:hover {
  background: #f3f4f6;
}

.test-case-title {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.test-case-title h5 {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  color: #1a1a1a;
}

.test-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #2563eb;
}

.test-checkbox:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.test-kind-badge {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.test-kind-badge.happy_path {
  background: #d1fae5;
  color: #065f46;
}

.test-kind-badge.edge_case {
  background: #fef3c7;
  color: #92400e;
}

.test-status-badge {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 12px;
  font-weight: 500;
  white-space: nowrap;
  margin-left: 8px;
}

.test-status-badge.passed {
  background: #d1fae5;
  color: #065f46;
}

.test-status-badge.not-run {
  background: #f3f4f6;
  color: #6b7280;
}

.test-status-badge:not(.passed):not(.not-run) {
  background: #fee2e2;
  color: #991b1b;
}

.test-case-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.run-test-btn {
  padding: 6px 14px;
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.run-test-btn:hover:not(:disabled) {
  background: #1d4ed8;
}

.run-test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.expand-btn {
  background: none;
  border: none;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  color: #6b7280;
}

.test-case-details {
  padding: 0 16px 16px 16px;
  border-top: 1px solid #e5e7eb;
}

.detail-section {
  margin-top: 16px;
}

.detail-section h6 {
  margin: 0 0 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.persona-info p {
  margin: 4px 0;
  font-size: 14px;
  color: #4b5563;
}

.persona-info .challenge {
  color: #92400e;
  background: #fef3c7;
  padding: 8px;
  border-radius: 6px;
  margin-top: 8px;
}

.scenario-text,
.pattern-text {
  margin: 0;
  font-size: 14px;
  color: #4b5563;
  line-height: 1.6;
}

.metadata {
  border-top: 1px solid #e5e7eb;
  padding-top: 12px;
  margin-top: 16px;
}

.metadata p {
  margin: 4px 0;
  font-size: 13px;
  color: #6b7280;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-content {
  background: white;
  border-radius: 12px;
  max-width: 900px;
  width: 100%;
  max-height: 90vh;
  overflow: auto;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px;
  border-bottom: 1px solid #e5e7eb;
}

.modal-header h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  font-size: 28px;
  cursor: pointer;
  color: #6b7280;
  line-height: 1;
  padding: 0;
  width: 32px;
  height: 32px;
}

.close-btn:hover {
  color: #1a1a1a;
}

.modal-body {
  padding: 24px;
}

.results-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid #e5e7eb;
}

.summary-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-stat .label {
  font-size: 13px;
  color: #6b7280;
}

.summary-stat .value {
  font-size: 24px;
  font-weight: 700;
  color: #1a1a1a;
}

.results-list {
  display: grid;
  gap: 16px;
}

.result-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.result-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 500;
}

.result-status {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ef4444;
  color: white;
  font-size: 14px;
}

.result-status.passed {
  background: #10b981;
}

.attempt-badge {
  font-size: 12px;
  background: white;
  padding: 2px 8px;
  border-radius: 4px;
  color: #6b7280;
}

.criterion-outcomes {
  border-top: 1px solid #e5e7eb;
  padding-top: 16px;
}

.criterion-outcomes h6 {
  margin: 0 0 12px 0;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.outcome-item {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 8px;
}

.outcome-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.outcome-status {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: white;
}

.outcome-status.pass {
  background: #10b981;
}

.outcome-status.fail {
  background: #ef4444;
}

.confidence {
  font-size: 12px;
  color: #6b7280;
}

.rationale {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: #374151;
  line-height: 1.5;
}

.evidence {
  margin: 0;
  font-size: 13px;
  color: #6b7280;
  font-style: italic;
  padding: 8px;
  background: #f9fafb;
  border-radius: 4px;
}
</style>
