<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  agentId: string
  locationId: string
  companyId?: string
  agentName?: string
}>(), {
  companyId: '',
  agentName: 'Voice AI Agent',
})

type Phase = 'idle' | 'running' | 'review' | 'finishing' | 'done' | 'blocked' | 'error'
type StepId = 'sync_agent' | 'sync_calls' | 'rubric' | 'evaluate' | 'patterns' | 'tests' | 'review' | 'run' | 'recs'
type ModalKind = 'test' | 'pattern' | 'rec' | null

interface StepDef {
  id: StepId
  label: string
  hint: string
}

const STEPS: StepDef[] = [
  { id: 'sync_agent', label: 'Sync', hint: 'Pull the latest agent configuration' },
  { id: 'sync_calls', label: 'Calls', hint: 'Fetch recent conversations from HighLevel' },
  { id: 'rubric', label: 'Rubric', hint: 'Create evaluation criteria from the prompt' },
  { id: 'evaluate', label: 'Analyze', hint: 'Score each conversation' },
  { id: 'patterns', label: 'Issues', hint: 'Detect repeating failure patterns' },
  { id: 'tests', label: 'Tests', hint: 'Generate cases from those patterns' },
  { id: 'review', label: 'Review', hint: 'Edit or skip a test, then continue' },
  { id: 'run', label: 'Run', hint: 'Simulate the remaining cases' },
  { id: 'recs', label: 'Recommend', hint: 'Turn findings into prompt and action changes' },
]

const AUTO_STEPS: StepId[] = ['sync_agent', 'sync_calls', 'rubric', 'evaluate', 'patterns', 'tests']

const phase = ref<Phase>('idle')
const currentStep = ref<StepId | null>(null)
const doneSteps = ref<StepId[]>([])
const error = ref('')
const toast = ref('')
const saving = ref(false)
const summary = ref({ calls: 0, patterns: 0, tests: 0, passed: 0, failed: 0, recommendations: 0 })
const testCases = ref<any[]>([])
const skippedIds = ref<string[]>([])
const patterns = ref<any[]>([])
const recommendations = ref<any[]>([])
const version = ref<{ id: string, label: string, createdAt?: string } | null>(null)
const lastOptimizedAt = ref<string | null>(null)
const alreadyOptimized = ref(false)

const modalKind = ref<ModalKind>(null)
const modalItem = ref<any>(null)
const draft = ref({ title: '', scenario: '', name: '', needs: '', style: '' })

const progress = computed(() => Math.round((doneSteps.value.length / STEPS.length) * 100))
const currentHint = computed(() => STEPS.find((item) => item.id === currentStep.value)?.hint || '')
const activeTests = computed(() => testCases.value.filter((item) => !skippedIds.value.includes(item.id)))

const versionLine = computed(() => {
  if (!version.value) return 'No synced version yet'
  const label = version.value.label || 'current'
  if (alreadyOptimized.value && lastOptimizedAt.value) {
    return `Version ${label} · optimized ${formatWhen(lastOptimizedAt.value)}`
  }
  if (alreadyOptimized.value) return `Version ${label} · already optimized`
  return `Version ${label} · not optimized yet`
})

function formatWhen(value: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return 'recently'
  }
}

function stepState(id: StepId) {
  if (doneSteps.value.includes(id)) return 'done'
  if (currentStep.value === id) return 'current'
  return 'todo'
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `Request failed (${response.status})`)
  }
  return data
}

async function loadStatus() {
  if (!props.agentId) return
  try {
    const data = await api(`/api/optimize/status/${props.agentId}`)
    version.value = data.version
    alreadyOptimized.value = !!data.optimized
    lastOptimizedAt.value = data.lastOptimizedAt || null
    if (phase.value === 'idle') {
      patterns.value = data.patterns || []
      recommendations.value = data.recommendations || []
      summary.value.patterns = data.patternCount || patterns.value.length
      summary.value.recommendations = data.recommendationCount || recommendations.value.length
    }
  } catch {
    /* status is optional chrome */
  }
}

async function runStep(step: StepId, extra: Record<string, unknown> = {}) {
  currentStep.value = step
  const data = await api('/api/optimize/step', {
    method: 'POST',
    body: JSON.stringify({
      agentId: props.agentId,
      locationId: props.locationId,
      companyId: props.companyId || undefined,
      step,
      ...extra,
    }),
  })
  if (!doneSteps.value.includes(step)) doneSteps.value = [...doneSteps.value, step]
  if (data.versionId && !version.value) {
    version.value = { id: data.versionId, label: 'current' }
  }
  return data
}

async function startOptimize() {
  if (!props.agentId || !props.locationId) {
    error.value = 'Missing agent or location. Reopen this agent from HighLevel.'
    phase.value = 'error'
    return
  }

  phase.value = 'running'
  error.value = ''
  toast.value = ''
  doneSteps.value = []
  skippedIds.value = []
  recommendations.value = []
  testCases.value = []
  patterns.value = []
  summary.value = { calls: 0, patterns: 0, tests: 0, passed: 0, failed: 0, recommendations: 0 }
  closeModal()

  try {
    for (const step of AUTO_STEPS) {
      const result = await runStep(step)
      if (step === 'sync_calls') {
        summary.value.calls = result.count || 0
        if (result.blocked || !result.count) {
          phase.value = 'blocked'
          currentStep.value = null
          return
        }
      }
      if (step === 'rubric' && result.versionId) {
        version.value = { id: result.versionId, label: version.value?.label || 'current' }
      }
      if (step === 'patterns') {
        summary.value.patterns = result.patternCount || 0
        patterns.value = result.patterns || []
      }
      if (step === 'tests') {
        testCases.value = result.testCases || []
        summary.value.tests = testCases.value.length
      }
    }
    currentStep.value = 'review'
    phase.value = 'review'
    toast.value = 'Review the tests. Click a card to edit it.'
  } catch (err: any) {
    phase.value = 'error'
    error.value = err.message || 'Optimize failed'
    currentStep.value = null
  }
}

function openTest(test: any) {
  modalKind.value = 'test'
  modalItem.value = test
  draft.value = {
    title: test.title || '',
    scenario: test.scenario || '',
    name: test.persona?.name || '',
    needs: test.persona?.needs || '',
    style: test.persona?.communication_style || test.persona?.communicationStyle || '',
  }
}

function openPattern(pattern: any) {
  modalKind.value = 'pattern'
  modalItem.value = pattern
}

function openRec(rec: any) {
  modalKind.value = 'rec'
  modalItem.value = rec
}

function closeModal() {
  modalKind.value = null
  modalItem.value = null
}

function skipTest(id: string) {
  if (!skippedIds.value.includes(id)) skippedIds.value = [...skippedIds.value, id]
  if (modalItem.value?.id === id) closeModal()
}

function keepTest(id: string) {
  skippedIds.value = skippedIds.value.filter((item) => item !== id)
}

async function saveTest() {
  if (!modalItem.value?.id) return
  saving.value = true
  error.value = ''
  try {
    const data = await api(`/api/tests/${modalItem.value.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: draft.value.title,
        scenario: draft.value.scenario,
        persona: {
          ...(modalItem.value.persona || {}),
          name: draft.value.name,
          needs: draft.value.needs,
          communication_style: draft.value.style,
        },
      }),
    })
    const updated = data.testCase || {}
    testCases.value = testCases.value.map((item) => (
      item.id === modalItem.value.id
        ? {
            ...item,
            ...updated,
            title: draft.value.title,
            scenario: draft.value.scenario,
            persona: {
              ...(item.persona || {}),
              name: draft.value.name,
              needs: draft.value.needs,
              communication_style: draft.value.style,
            },
          }
        : item
    ))
    toast.value = 'Test case updated'
    closeModal()
  } catch (err: any) {
    error.value = err.message || 'Could not save test case'
  } finally {
    saving.value = false
  }
}

async function continueAfterReview() {
  if (!activeTests.value.length) {
    error.value = 'Keep at least one test case to continue.'
    return
  }

  phase.value = 'finishing'
  error.value = ''
  toast.value = ''
  closeModal()
  if (!doneSteps.value.includes('review')) doneSteps.value = [...doneSteps.value, 'review']

  try {
    for (const skipped of skippedIds.value) {
      await fetch(`/api/tests/${skipped}/archive`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      }).catch(() => null)
    }

    const runResult = await runStep('run', {
      testCaseIds: activeTests.value.map((item) => item.id),
    })
    summary.value.passed = runResult.totalPassed || 0
    summary.value.failed = runResult.totalFailed || 0

    const recResult = await runStep('recs')
    recommendations.value = recResult.recommendations || []
    summary.value.recommendations = recResult.accepted || recommendations.value.length
    alreadyOptimized.value = true
    lastOptimizedAt.value = new Date().toISOString()
    if (recResult.versionId) {
      version.value = { id: recResult.versionId, label: version.value?.label || 'current' }
    }

    currentStep.value = null
    phase.value = 'done'
    toast.value = 'Optimization finished.'
    await loadStatus()
  } catch (err: any) {
    phase.value = 'error'
    error.value = err.message || 'Could not finish optimization'
    currentStep.value = null
  }
}

function recTitle(rec: any) {
  return String(rec.recType || rec.rec_type || 'Recommendation').replace(/_/g, ' ')
}

function recBody(rec: any) {
  return rec.rationale || rec.payload?.summary || 'Suggested change for this agent.'
}

function patternTitle(pattern: any) {
  return pattern.title || 'Issue pattern'
}

onMounted(loadStatus)
</script>

<template>
  <div class="pipe">
    <header class="pipe-top">
      <div class="min">
        <p class="kicker">Optimize</p>
        <h1>{{ agentName }}</h1>
        <p class="version" :class="{ ready: alreadyOptimized }">{{ versionLine }}</p>
      </div>
      <button
        v-if="phase === 'idle' || phase === 'done' || phase === 'blocked' || phase === 'error'"
        type="button"
        class="btn primary"
        :disabled="!agentId || !locationId"
        @click="startOptimize"
      >
        {{ alreadyOptimized || phase === 'done' ? 'Run again' : 'Optimize this agent' }}
      </button>
    </header>

    <div v-if="toast" class="toast">{{ toast }}</div>
    <div v-if="error" class="banner">{{ error }}</div>

    <div class="track">
      <div class="bar"><span :style="{ width: `${progress}%` }" /></div>
      <p class="status">
        <template v-if="phase === 'idle' && alreadyOptimized">This version already has results. Open a card to inspect, or run again.</template>
        <template v-else-if="phase === 'idle'">We pull calls, analyze issues, pause so you can edit tests, then recommend changes.</template>
        <template v-else-if="phase === 'running' || phase === 'finishing'">{{ currentHint || 'Working…' }}</template>
        <template v-else-if="phase === 'review'">Click a test to edit it. Skip only what you do not want to run.</template>
        <template v-else-if="phase === 'blocked'">No calls in HighLevel yet. Place a test or live call, then run again.</template>
        <template v-else-if="phase === 'done'">Done. Open a card for details.</template>
        <template v-else>Stopped. Fix the issue above, then run again.</template>
      </p>
    </div>

    <ol class="steps">
      <li v-for="step in STEPS" :key="step.id" :class="stepState(step.id)">
        <span class="dot" />
        <span>{{ step.label }}</span>
      </li>
    </ol>

    <section v-if="phase === 'review'" class="stage">
      <div class="stage-head">
        <h2>{{ activeTests.length }} tests will run</h2>
        <div class="actions">
          <button type="button" class="btn primary" @click="continueAfterReview">Continue</button>
        </div>
      </div>
      <div class="grid">
        <button
          v-for="test in testCases"
          :key="test.id"
          type="button"
          class="tile"
          :class="{ skipped: skippedIds.includes(test.id) }"
          @click="openTest(test)"
        >
          <span class="chip">{{ test.kind === 'edge_case' ? 'Edge' : 'Happy' }}</span>
          <strong>{{ test.title || 'Untitled test' }}</strong>
          <em>{{ skippedIds.includes(test.id) ? 'Skipped' : 'Click to edit' }}</em>
        </button>
      </div>
    </section>

    <section v-else-if="phase === 'idle' || phase === 'done'" class="stage">
      <div v-if="patterns.length || recommendations.length" class="boards">
        <div>
          <h2>Issues</h2>
          <div v-if="patterns.length" class="grid">
            <button v-for="pattern in patterns" :key="pattern.id" type="button" class="tile" @click="openPattern(pattern)">
              <span class="chip">Issue</span>
              <strong>{{ patternTitle(pattern) }}</strong>
              <em>{{ pattern.fail_count || pattern.failCount || 0 }} failing calls</em>
            </button>
          </div>
          <p v-else class="empty">No issue cards yet.</p>
        </div>
        <div>
          <h2>Recommendations</h2>
          <div v-if="recommendations.length" class="grid">
            <button v-for="rec in recommendations" :key="rec.id" type="button" class="tile" @click="openRec(rec)">
              <span class="chip">Change</span>
              <strong>{{ recTitle(rec) }}</strong>
              <em>{{ rec.tier || rec.status || 'proposed' }}</em>
            </button>
          </div>
          <p v-else class="empty">No recommendations yet.</p>
        </div>
      </div>
      <p v-else-if="phase === 'done'" class="empty">No new recommendations this run.</p>
    </section>

    <div v-if="modalKind" class="overlay" @click.self="closeModal">
      <div class="modal" role="dialog" aria-modal="true">
        <header>
          <h3>
            <template v-if="modalKind === 'test'">Edit test</template>
            <template v-else-if="modalKind === 'pattern'">Issue</template>
            <template v-else>Recommendation</template>
          </h3>
          <button type="button" class="icon" @click="closeModal">×</button>
        </header>

        <div v-if="modalKind === 'test'" class="form">
          <label>Title<input v-model="draft.title" type="text" /></label>
          <label>Scenario<textarea v-model="draft.scenario" rows="4" /></label>
          <div class="split">
            <label>Caller<input v-model="draft.name" type="text" /></label>
            <label>Style<input v-model="draft.style" type="text" /></label>
          </div>
          <label>Need<input v-model="draft.needs" type="text" /></label>
          <div class="actions">
            <button type="button" class="btn primary" :disabled="saving" @click="saveTest">
              {{ saving ? 'Saving…' : 'Save changes' }}
            </button>
            <button
              type="button"
              class="btn ghost"
              @click="skippedIds.includes(modalItem.id) ? keepTest(modalItem.id) : skipTest(modalItem.id)"
            >
              {{ skippedIds.includes(modalItem.id) ? 'Keep this test' : 'Skip this test' }}
            </button>
          </div>
        </div>

        <div v-else-if="modalKind === 'pattern'" class="detail">
          <p class="lead">{{ patternTitle(modalItem) }}</p>
          <p>{{ modalItem.description || 'No description provided.' }}</p>
          <p class="meta">
            Failed on {{ modalItem.fail_count || modalItem.failCount || 0 }} of
            {{ modalItem.call_count || modalItem.callCount || 0 }} calls
          </p>
        </div>

        <div v-else class="detail">
          <p class="lead">{{ recTitle(modalItem) }}</p>
          <p>{{ recBody(modalItem) }}</p>
          <p v-if="modalItem.payload?.diff || modalItem.payload?.changes" class="meta">
            Open this card after applying changes in the HighLevel builder.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pipe {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 18px 20px;
  background: #fff;
  color: #111827;
}

.pipe-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.min { min-width: 0; }

.kicker {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #2563eb;
}

h1 {
  margin: 2px 0 4px;
  font-size: 20px;
}

.version {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
}

.version.ready { color: #047857; }

.track { margin: 14px 0 10px; }

.bar {
  height: 6px;
  border-radius: 999px;
  background: #e5e7eb;
  overflow: hidden;
}

.bar span {
  display: block;
  height: 100%;
  background: #2563eb;
  transition: width 0.25s ease;
}

.status {
  margin: 8px 0 0;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.4;
}

.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
}

.steps li {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #9ca3af;
  font-size: 12px;
}

.steps li.current { color: #111827; font-weight: 650; }
.steps li.done { color: #047857; }

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #d1d5db;
}
.current .dot { background: #2563eb; }
.done .dot { background: #059669; }

.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.stage-head, .actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

h2 { margin: 0 0 10px; font-size: 15px; }

.boards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  min-height: 0;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}

.tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-height: 92px;
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.tile:hover { border-color: #93c5fd; }
.tile.skipped { opacity: 0.45; }

.tile strong {
  font-size: 13px;
  line-height: 1.3;
}

.tile em {
  font-style: normal;
  color: #6b7280;
  font-size: 11px;
}

.chip {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #2563eb;
}

.btn {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.primary { background: #2563eb; color: #fff; }
.ghost { background: #fff; color: #374151; border-color: #d1d5db; }

.toast, .banner {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
}
.toast { background: #eff6ff; color: #1d4ed8; }
.banner { background: #fef2f2; color: #991b1b; }
.empty { color: #6b7280; font-size: 13px; }

.overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.35);
  padding: 20px;
}

.modal {
  width: min(520px, 100%);
  max-height: min(80vh, 640px);
  overflow: auto;
  background: #fff;
  border-radius: 14px;
  padding: 16px;
}

.modal header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.modal h3 { margin: 0; font-size: 16px; }

.icon {
  width: 32px;
  height: 32px;
  border: 0;
  background: transparent;
  font-size: 22px;
  cursor: pointer;
}

.form, .detail { display: flex; flex-direction: column; gap: 10px; }

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #374151;
}

input, textarea {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-weight: 400;
  color: #111827;
}

.split { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

.lead { margin: 0; font-weight: 650; }
.detail p { margin: 0; color: #374151; font-size: 14px; line-height: 1.5; }
.meta { color: #6b7280 !important; font-size: 12px !important; }

@media (max-width: 720px) {
  .boards { grid-template-columns: 1fr; }
}
</style>
