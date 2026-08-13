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

type Phase = 'idle' | 'running' | 'select' | 'finishing' | 'done' | 'blocked' | 'error'
type StepId = 'sync_agent' | 'sync_calls' | 'rubric' | 'evaluate' | 'patterns' | 'tests' | 'run' | 'recs'
type ViewId = 'calls' | 'rubric' | 'evaluate' | 'patterns' | 'tests' | 'run' | 'recs'
type ModalKind = ViewId | null

interface StepDef {
  id: StepId
  view?: ViewId
  label: string
  hint: string
  accent: string
}

const STEPS: StepDef[] = [
  { id: 'sync_agent', label: 'Sync', hint: 'Pull the latest agent configuration', accent: '#93c5fd' },
  { id: 'sync_calls', view: 'calls', label: 'Calls', hint: 'Recent conversations from HighLevel', accent: '#60a5fa' },
  { id: 'rubric', view: 'rubric', label: 'Rubric', hint: 'Evaluation criteria from the prompt', accent: '#3b82f6' },
  { id: 'evaluate', view: 'evaluate', label: 'Analyze', hint: 'How each call scored', accent: '#2563eb' },
  { id: 'patterns', view: 'patterns', label: 'Issues', hint: 'Repeating failure patterns', accent: '#1d4ed8' },
  { id: 'tests', view: 'tests', label: 'Tests', hint: 'Choose which tests to run. Click a row to edit.', accent: '#1e40af' },
  { id: 'run', view: 'run', label: 'Run', hint: 'Simulated test outcomes', accent: '#1e3a8a' },
  { id: 'recs', view: 'recs', label: 'Recommend', hint: 'Suggested prompt and action changes', accent: '#172554' },
]

const AUTO_STEPS: StepId[] = ['sync_agent', 'sync_calls', 'rubric', 'evaluate', 'patterns', 'tests']

const phase = ref<Phase>('idle')
const currentStep = ref<StepId | null>(null)
const selectedView = ref<ViewId>('calls')
const doneSteps = ref<StepId[]>([])
const error = ref('')
const toast = ref('')
const saving = ref(false)
const loadingFindings = ref(false)
const findings = ref<any[]>([])

const calls = ref<any[]>([])
const rubric = ref<any>(null)
const patterns = ref<any[]>([])
const testCases = ref<any[]>([])
const selectedIds = ref<string[]>([])
const runResults = ref<any[]>([])
const runMetrics = ref({ total: 0, passed: 0, failed: 0, passRate: 0, status: '', startedAt: '', finishedAt: '' })
const recommendations = ref<any[]>([])
const navItems = computed(() => STEPS.filter((step) => step.view))
const version = ref<{ id: string, label: string, createdAt?: string } | null>(null)
const lastOptimizedAt = ref<string | null>(null)
const alreadyOptimized = ref(false)

const modalKind = ref<ModalKind>(null)
const modalItem = ref<any>(null)
const draft = ref({ title: '', scenario: '', name: '', needs: '', style: '' })

const currentHint = computed(() => STEPS.find((item) => item.id === currentStep.value)?.hint || '')
const processedCount = computed(() => {
  if (phase.value === 'done' || (phase.value === 'idle' && alreadyOptimized.value)) return STEPS.length
  return doneSteps.value.length
})
const progressPercent = computed(() => Math.round((processedCount.value / STEPS.length) * 100))
const progressLabel = computed(() => {
  if (phase.value === 'running' || phase.value === 'finishing') {
    return `${progressPercent.value}% · ${processedCount.value} of ${STEPS.length} complete`
  }
  if (phase.value === 'select') return `${progressPercent.value}% · choose tests to continue`
  if (phase.value === 'done' || (phase.value === 'idle' && alreadyOptimized.value)) return '100% · run complete'
  if (phase.value === 'blocked') return `${progressPercent.value}% · waiting on calls`
  return `${progressPercent.value}%`
})
const selectedTests = computed(() => testCases.value.filter((item) => selectedIds.value.includes(item.id)))
const allSelected = computed(() => testCases.value.length > 0 && selectedIds.value.length === testCases.value.length)
const criteria = computed(() => rubric.value?.criteria || [])
const canEditTests = computed(() => phase.value === 'select' || phase.value === 'idle' || phase.value === 'done')
const passedCount = computed(() => runResults.value.filter((item) => item.passed).length)

function stepCount(step: StepDef) {
  if (step.view === 'calls' || step.view === 'evaluate') return calls.value.length
  if (step.view === 'rubric') return criteria.value.length
  if (step.view === 'patterns') return patterns.value.length
  if (step.view === 'tests') return testCases.value.length
  if (step.view === 'run') return runResults.value.length
  if (step.view === 'recs') return recommendations.value.length
  return 0
}

function stepSummary(step: StepDef) {
  const state = stepState(step.id)
  if (state === 'current' && (phase.value === 'running' || phase.value === 'finishing')) return currentHint.value || 'Working…'
  if (state === 'todo') return 'Waiting'
  if (step.id === 'sync_agent') return 'Agent synced'
  if (step.view === 'tests' && phase.value === 'select') {
    return `${selectedIds.value.length} of ${testCases.value.length} selected`
  }
  if (step.view === 'run' && runResults.value.length) {
    return `${passedCount.value} passed · ${runResults.value.length - passedCount.value} failed`
  }
  const count = stepCount(step)
  if (!count) return state === 'done' ? 'Done' : 'Waiting'
  const noun = step.view === 'calls' || step.view === 'evaluate' ? 'calls'
    : step.view === 'rubric' ? 'criteria'
    : step.view === 'patterns' ? 'issues'
    : step.view === 'tests' ? 'tests'
    : step.view === 'run' ? 'results'
    : 'recommendations'
  return `${count} ${noun}`
}

function applyRunMetrics(data: any, results: any[] = []) {
  const total = Number(data?.total ?? data?.totalTests ?? results.length) || 0
  const passed = Number(data?.passed ?? data?.totalPassed ?? results.filter((item) => item.passed).length) || 0
  const failed = Number(data?.failed ?? data?.totalFailed ?? Math.max(0, total - passed)) || 0
  runMetrics.value = {
    total,
    passed,
    failed,
    passRate: total ? Number(((passed / total) * 100).toFixed(1)) : 0,
    status: data?.status || '',
    startedAt: data?.startedAt || data?.started_at || '',
    finishedAt: data?.finishedAt || data?.finished_at || '',
  }
}

function runDuration() {
  if (!runMetrics.value.startedAt || !runMetrics.value.finishedAt) return ''
  const ms = new Date(runMetrics.value.finishedAt).getTime() - new Date(runMetrics.value.startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

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
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return 'recently'
  }
}

function formatKey(value = '') {
  return String(value).replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim()
    .split(' ').map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
}

function formatDate(value?: string) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  } catch {
    return '—'
  }
}

function stepState(id: StepId) {
  if (doneSteps.value.includes(id)) return 'done'
  if (currentStep.value === id) return 'current'
  return 'todo'
}

function canOpenStep(step: StepDef) {
  if (!step.view) return false
  if (doneSteps.value.includes(step.id)) return true
  if (step.view === 'calls' && calls.value.length) return true
  if (step.view === 'rubric' && criteria.value.length) return true
  if (step.view === 'patterns' && patterns.value.length) return true
  if (step.view === 'tests' && testCases.value.length) return true
  if (step.view === 'recs' && recommendations.value.length) return true
  if (step.view === 'run' && runResults.value.length) return true
  if (step.view === 'evaluate' && calls.value.length && (phase.value === 'done' || doneSteps.value.includes('evaluate'))) return true
  return false
}

function openStep(step: StepDef) {
  if (!step.view) return
  if (!canOpenStep(step) && stepState(step.id) !== 'current') return
  selectedView.value = step.view
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

function applyStatus(data: any) {
  version.value = data.version
  alreadyOptimized.value = !!data.optimized
  lastOptimizedAt.value = data.lastOptimizedAt || null
  calls.value = data.calls || []
  rubric.value = data.rubric || null
  patterns.value = data.patterns || []
  testCases.value = data.testCases || []
  recommendations.value = data.recommendations || []
  runResults.value = data.lastRunResults || []
  if (data.lastRunMetrics) applyRunMetrics(data.lastRunMetrics, runResults.value)
  if (data.optimized) {
    doneSteps.value = ['sync_agent', 'sync_calls', 'rubric', 'evaluate', 'patterns', 'tests', 'run', 'recs']
    selectedView.value = recommendations.value.length ? 'recs' : (patterns.value.length ? 'patterns' : 'calls')
  } else if (calls.value.length) {
    selectedView.value = 'calls'
  }
}

async function loadStatus() {
  if (!props.agentId) return
  try {
    applyStatus(await api(`/api/optimize/status/${props.agentId}`))
  } catch {
    /* optional chrome */
  }
}

async function runStep(step: StepId, extra: Record<string, unknown> = {}) {
  currentStep.value = step
  const def = STEPS.find((item) => item.id === step)
  if (def?.view) selectedView.value = def.view
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
  if (data.versionId && !version.value) version.value = { id: data.versionId, label: 'current' }
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
  selectedIds.value = []
  runResults.value = []
  closeModal()

  try {
    for (const step of AUTO_STEPS) {
      const result = await runStep(step)
      if (step === 'sync_calls') {
        calls.value = result.calls || []
        if (result.blocked || !result.count) {
          phase.value = 'blocked'
          currentStep.value = null
          selectedView.value = 'calls'
          return
        }
      }
      if (step === 'rubric') {
        rubric.value = result.rubric || rubric.value
        if (result.versionId) version.value = { id: result.versionId, label: version.value?.label || 'current' }
      }
      if (step === 'evaluate' && result.calls) calls.value = result.calls
      if (step === 'patterns') patterns.value = result.patterns || []
      if (step === 'tests') {
        testCases.value = result.testCases || []
        selectedIds.value = []
        // Keep Tests as the current step until the user chooses what to run.
        doneSteps.value = doneSteps.value.filter((id) => id !== 'tests')
      }
    }
    currentStep.value = 'tests'
    selectedView.value = 'tests'
    phase.value = 'select'
    toast.value = 'Select the tests to run. Click a row to edit one.'
  } catch (err: any) {
    phase.value = 'error'
    error.value = err.message || 'Optimize failed'
    currentStep.value = null
  }
}

function personaOf(item: any) {
  const raw = item?.persona
  if (!raw) return {}
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return {} }
  }
  return raw
}

function openModal(kind: ViewId, item: any) {
  modalKind.value = kind
  modalItem.value = item
  findings.value = []
  if (kind === 'tests') {
    const persona = personaOf(item)
    draft.value = {
      title: item.title || '',
      scenario: item.scenario || '',
      name: persona.name || '',
      needs: persona.needs || '',
      style: persona.communication_style || persona.communicationStyle || '',
    }
  }
  if (kind === 'calls' || kind === 'evaluate') {
    loadFindings(item.id)
  }
}

async function loadFindings(callId: string) {
  if (!callId) return
  loadingFindings.value = true
  try {
    const data = await fetch(`/api/analysis/findings/${callId}`).then((res) => res.json()).catch(() => ({}))
    findings.value = data.findings || []
  } finally {
    loadingFindings.value = false
  }
}

function closeModal() {
  modalKind.value = null
  modalItem.value = null
  findings.value = []
}

function isSelected(id: string) {
  return selectedIds.value.includes(id)
}

function toggleSelect(id: string) {
  selectedIds.value = isSelected(id)
    ? selectedIds.value.filter((item) => item !== id)
    : [...selectedIds.value, id]
}

function selectAll() {
  selectedIds.value = testCases.value.map((item) => item.id)
}

function selectNone() {
  selectedIds.value = []
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
          ...personaOf(modalItem.value),
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
              ...personaOf(item),
              name: draft.value.name,
              needs: draft.value.needs,
              communication_style: draft.value.style,
            },
          }
        : item
    ))
    toast.value = 'Test case saved'
    closeModal()
  } catch (err: any) {
    error.value = err.message || 'Could not save test case'
  } finally {
    saving.value = false
  }
}

async function continueAfterReview() {
  if (!selectedTests.value.length) {
    error.value = 'Select at least one test to run.'
    return
  }

  phase.value = 'finishing'
  error.value = ''
  toast.value = ''
  closeModal()
  if (!doneSteps.value.includes('tests')) doneSteps.value = [...doneSteps.value, 'tests']

  try {
    const runResult = await runStep('run', {
      testCaseIds: selectedTests.value.map((item) => item.id),
    })
    runResults.value = runResult.results || []
    applyRunMetrics(runResult, runResults.value)

    const recResult = await runStep('recs')
    recommendations.value = recResult.recommendations || []
    alreadyOptimized.value = true
    lastOptimizedAt.value = new Date().toISOString()
    if (recResult.versionId) version.value = { id: recResult.versionId, label: version.value?.label || 'current' }

    currentStep.value = null
    selectedView.value = 'recs'
    phase.value = 'done'
    toast.value = 'Optimization finished. Click a row to inspect it.'
    await loadStatus()
  } catch (err: any) {
    phase.value = 'error'
    error.value = err.message || 'Could not finish optimization'
    currentStep.value = null
  }
}

function recTitle(rec: any) {
  return formatKey(rec.recType || rec.rec_type || 'Recommendation')
}

function recBody(rec: any) {
  return rec.rationale || rec.payload?.summary || 'Suggested change for this agent.'
}

onMounted(loadStatus)
</script>

<template>
  <div class="pipe">
    <header class="head">
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

    <div class="progress" aria-label="Optimize progress">
      <div class="progress-top">
        <span>{{ progressLabel }}</span>
        <strong>{{ progressPercent }}%</strong>
      </div>
      <div class="progress-track">
        <span :style="{ width: `${progressPercent}%` }" />
      </div>
    </div>

    <p v-if="toast" class="toast">{{ toast }}</p>
    <p v-if="error" class="banner">{{ error }}</p>

    <div class="workspace">
      <nav class="nav" aria-label="Optimize sections">
        <p class="nav-label">Pipeline</p>
        <button
          v-for="step in navItems"
          :key="step.id"
          type="button"
          class="nav-link"
          :class="[stepState(step.id), { active: selectedView === step.view }]"
          :disabled="!canOpenStep(step) && stepState(step.id) !== 'current'"
          @click="openStep(step)"
        >
          <span class="nav-name">{{ step.label }}</span>
          <span class="nav-count">{{ stepSummary(step) }}</span>
        </button>
      </nav>

      <section class="content">
        <div class="content-head">
          <div>
            <h2>{{ navItems.find((item) => item.view === selectedView)?.label }}</h2>
            <p>{{ currentHint || stepSummary(navItems.find((item) => item.view === selectedView) || STEPS[1]) }}</p>
          </div>
          <div v-if="selectedView === 'tests' && phase === 'select'" class="head-actions">
            <button type="button" class="btn ghost" @click="allSelected ? selectNone() : selectAll()">
              {{ allSelected ? 'Clear all' : 'Select all' }}
            </button>
            <button type="button" class="btn primary" :disabled="!selectedIds.length" @click="continueAfterReview">
              Run {{ selectedIds.length || 0 }} selected
            </button>
          </div>
        </div>

        <div v-if="selectedView === 'run'" class="metrics">
          <article>
            <strong>{{ runMetrics.total }}</strong>
            <span>Tests</span>
          </article>
          <article>
            <strong class="ok">{{ runMetrics.passed }}</strong>
            <span>Passed</span>
          </article>
          <article>
            <strong class="bad">{{ runMetrics.failed }}</strong>
            <span>Failed</span>
          </article>
          <article>
            <strong>{{ runMetrics.passRate }}%</strong>
            <span>Pass rate</span>
          </article>
          <article v-if="runDuration()">
            <strong>{{ runDuration() }}</strong>
            <span>Duration</span>
          </article>
        </div>

        <div class="rows">
          <template v-if="selectedView === 'calls' || selectedView === 'evaluate'">
            <button v-for="call in calls" :key="call.id" type="button" class="row" @click="openModal(selectedView, call)">
              <div class="main">
                <strong>{{ call.summary || 'No summary' }}</strong>
                <span>{{ formatDate(call.created_at_ghl) }} · {{ call.duration_s || 0 }}s</span>
              </div>
              <span class="badge" :class="call.kind">{{ call.kind || 'call' }}</span>
            </button>
            <p v-if="!calls.length" class="empty">No calls yet.</p>
          </template>

          <template v-else-if="selectedView === 'rubric'">
            <button v-for="item in criteria" :key="item.id" type="button" class="row" @click="openModal('rubric', item)">
              <div class="main">
                <strong>{{ formatKey(item.key) }}</strong>
                <span>{{ item.category }} · {{ item.checkType || item.check_type }}</span>
              </div>
              <span class="badge" :class="`sev-${item.severity}`">
                {{ item.severity === 3 ? 'Critical' : item.severity === 2 ? 'Important' : 'Polish' }}
              </span>
            </button>
            <p v-if="!criteria.length" class="empty">No rubric yet.</p>
          </template>

          <template v-else-if="selectedView === 'patterns'">
            <button v-for="pattern in patterns" :key="pattern.id" type="button" class="row" @click="openModal('patterns', pattern)">
              <div class="main">
                <strong>{{ formatKey(pattern.title) }}</strong>
                <span>{{ pattern.fail_count || pattern.failCount || 0 }} failing calls</span>
              </div>
              <span class="badge">{{ Number(pattern.impact_score || pattern.impactScore || 0).toFixed(1) }} impact</span>
            </button>
            <p v-if="!patterns.length" class="empty">No issues yet.</p>
          </template>

          <template v-else-if="selectedView === 'tests'">
            <div v-for="test in testCases" :key="test.id" class="row" :class="{ picked: isSelected(test.id) }">
              <label v-if="phase === 'select'" class="check" @click.stop>
                <input type="checkbox" :checked="isSelected(test.id)" @change="toggleSelect(test.id)" />
              </label>
              <button type="button" class="row-hit" @click="openModal('tests', test)">
                <div class="main">
                  <strong>{{ test.title || 'Untitled test' }}</strong>
                  <span>{{ test.kind === 'edge_case' ? 'Edge case' : 'Happy path' }}</span>
                </div>
                <span class="badge">{{ canEditTests ? 'Edit' : 'View' }}</span>
              </button>
            </div>
            <p v-if="!testCases.length" class="empty">No tests yet.</p>
          </template>

          <template v-else-if="selectedView === 'run'">
            <button v-for="result in runResults" :key="result.id || result.test_case_id" type="button" class="row" @click="openModal('run', result)">
              <div class="main">
                <strong>{{ result.test_case_title || result.title || 'Test result' }}</strong>
                <span>Attempt {{ result.attempt || 1 }}</span>
              </div>
              <span class="badge" :class="result.passed ? 'pass' : 'fail'">{{ result.passed ? 'Passed' : 'Failed' }}</span>
            </button>
            <p v-if="!runResults.length" class="empty">No results yet.</p>
          </template>

          <template v-else>
            <button v-for="rec in recommendations" :key="rec.id" type="button" class="row" @click="openModal('recs', rec)">
              <div class="main">
                <strong>{{ recTitle(rec) }}</strong>
                <span class="clamp">{{ recBody(rec) }}</span>
              </div>
              <span class="badge">{{ rec.tier || rec.status || 'proposed' }}</span>
            </button>
            <p v-if="!recommendations.length" class="empty">No recommendations yet.</p>
          </template>
        </div>
      </section>
    </div>

    <div v-if="modalKind" class="overlay" @click.self="closeModal">
      <div class="modal" role="dialog" aria-modal="true">
        <header>
          <h3>
            <template v-if="modalKind === 'tests'">{{ canEditTests ? 'Edit test case' : 'Test case' }}</template>
            <template v-else-if="modalKind === 'calls' || modalKind === 'evaluate'">Call</template>
            <template v-else-if="modalKind === 'rubric'">Criterion</template>
            <template v-else-if="modalKind === 'patterns'">Issue pattern</template>
            <template v-else-if="modalKind === 'run'">Test result</template>
            <template v-else>Recommendation</template>
          </h3>
          <button type="button" class="icon" @click="closeModal">×</button>
        </header>

        <div v-if="modalKind === 'tests'" class="form">
          <label>Title<input v-model="draft.title" type="text" /></label>
          <label>Scenario<textarea v-model="draft.scenario" rows="4" /></label>
          <div class="split">
            <label>Caller<input v-model="draft.name" type="text" /></label>
            <label>Style<input v-model="draft.style" type="text" /></label>
          </div>
          <label>Need<input v-model="draft.needs" type="text" /></label>
          <div class="actions">
            <button type="button" class="btn primary" :disabled="saving || !draft.title.trim() || !draft.scenario.trim()" @click="saveTest">
              {{ saving ? 'Saving…' : 'Save changes' }}
            </button>
            <button
              v-if="phase === 'select'"
              type="button"
              class="btn ghost"
              @click="toggleSelect(modalItem.id)"
            >
              {{ isSelected(modalItem.id) ? 'Unselect' : 'Select for run' }}
            </button>
          </div>
        </div>

        <div v-else-if="modalKind === 'calls' || modalKind === 'evaluate'" class="detail">
          <p class="lead">{{ modalItem.summary || 'No summary' }}</p>
          <p class="meta">{{ modalItem.kind }} · {{ formatDate(modalItem.created_at_ghl) }} · {{ modalItem.duration_s || 0 }}s</p>
          <p v-if="modalItem.raw_transcript" class="body">{{ modalItem.raw_transcript }}</p>
          <div v-if="loadingFindings" class="meta">Loading findings…</div>
          <ul v-else-if="findings.length" class="findings">
            <li v-for="finding in findings" :key="finding.id">
              <strong>{{ formatKey(finding.criterion_key) }}</strong>
              <span :class="finding.status">{{ finding.status }}</span>
              <p>{{ finding.rationale }}</p>
            </li>
          </ul>
        </div>

        <div v-else-if="modalKind === 'rubric'" class="detail">
          <p class="lead">{{ formatKey(modalItem.key) }}</p>
          <p>{{ modalItem.description }}</p>
          <p class="meta">{{ modalItem.category }} · severity {{ modalItem.severity }} · {{ modalItem.checkType || modalItem.check_type }}</p>
        </div>

        <div v-else-if="modalKind === 'patterns'" class="detail">
          <p class="lead">{{ formatKey(modalItem.title) }}</p>
          <p>{{ modalItem.description || 'No description.' }}</p>
          <p class="meta">
            Failed on {{ modalItem.fail_count || modalItem.failCount || 0 }} of
            {{ modalItem.call_count || modalItem.callCount || 0 }} calls
            · impact {{ Number(modalItem.impact_score || modalItem.impactScore || 0).toFixed(2) }}
          </p>
        </div>

        <div v-else-if="modalKind === 'run'" class="detail">
          <p class="lead">{{ modalItem.test_case_title || 'Test result' }}</p>
          <p class="meta">{{ modalItem.passed ? 'Passed' : 'Failed' }} · attempt {{ modalItem.attempt || 1 }}</p>
          <pre v-if="modalItem.criterion_outcomes">{{ typeof modalItem.criterion_outcomes === 'string' ? modalItem.criterion_outcomes : JSON.stringify(modalItem.criterion_outcomes, null, 2) }}</pre>
        </div>

        <div v-else class="detail">
          <p class="lead">{{ recTitle(modalItem) }}</p>
          <p>{{ recBody(modalItem) }}</p>
          <p class="meta">{{ modalItem.tier }} · {{ modalItem.status || 'proposed' }}</p>
          <pre v-if="modalItem.payload && !modalItem.payload.diff">{{ JSON.stringify(modalItem.payload, null, 2) }}</pre>
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
  background: #f3f4f6;
  color: #111827;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.min { min-width: 0; }
.kicker { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #2563eb; }
h1 { margin: 2px 0 4px; font-size: 20px; }
.version { margin: 0; color: #64748b; font-size: 12px; }
.version.ready { color: #047857; }

.progress {
  padding: 10px 16px 12px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.progress-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  color: #6b7280;
  font-size: 12px;
}

.progress-top strong {
  color: #2563eb;
  font-size: 13px;
}

.progress-track {
  height: 4px;
  border-radius: 99px;
  background: #e5e7eb;
  overflow: hidden;
}

.progress-track span {
  display: block;
  height: 100%;
  background: #2563eb;
  transition: width .25s ease;
}

.workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  margin: 12px 16px 16px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
}

.nav {
  width: 212px;
  flex-shrink: 0;
  padding: 12px 8px;
  border-right: 1px solid #e5e7eb;
  background: #fafafa;
}

.nav-label {
  margin: 0 8px 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: #9ca3af;
}

.nav-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-left: 2px solid transparent;
  border-radius: 0 6px 6px 0;
  background: transparent;
  color: #4b5563;
  text-align: left;
  cursor: pointer;
}

.nav-link:hover:not(:disabled) {
  background: #f3f4f6;
  color: #111827;
}

.nav-link.active {
  background: #fff;
  border-left-color: #2563eb;
  color: #2563eb;
  box-shadow: inset -1px 0 0 #fff;
}

.nav-link.current:not(.active) { color: #2563eb; }
.nav-link.todo { color: #9ca3af; }
.nav-link:disabled { cursor: default; }

.nav-name { font-size: 13px; font-weight: 600; }
.nav-count { font-size: 11px; color: #9ca3af; font-weight: 500; max-width: 92px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-link.active .nav-count { color: #60a5fa; }

.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.content-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid #f3f4f6;
}

.content-head h2 { margin: 0; font-size: 16px; }
.content-head p { margin: 4px 0 0; color: #6b7280; font-size: 12px; }
.head-actions { display: flex; gap: 8px; }

.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #f3f4f6;
  background: #fafafa;
}

.metrics article {
  padding: 8px 10px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.metrics strong { display: block; font-size: 18px; line-height: 1.2; }
.metrics span { color: #6b7280; font-size: 11px; }
.metrics .ok { color: #15803d; }
.metrics .bad { color: #b91c1c; }

.rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f3f4f6;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 1px 1px rgba(16, 24, 40, .03);
}

.row:hover {
  border-color: #cbd5e1;
}

.row.picked {
  background: #eff6ff;
  border-color: #bfdbfe;
}
.row-hit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.check {
  display: grid;
  place-items: center;
  padding-right: 4px;
}
.check input {
  width: 16px;
  height: 16px;
}

.main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.main strong { font-size: 13px; line-height: 1.35; }
.main span, .clamp { color: #64748b; font-size: 12px; }
.clamp { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }

.badge {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 99px;
  background: #f1f5f9;
  color: #334155;
  font-size: 11px;
  font-weight: 650;
  text-transform: capitalize;
}
.badge.real, .badge.pass { background: #dcfce7; color: #166534; }
.badge.simulated, .badge.fail { background: #fee2e2; color: #991b1b; }
.badge.sev-3 { background: #fee2e2; color: #991b1b; }
.badge.sev-2 { background: #fef3c7; color: #92400e; }

.empty { margin: 0; padding: 36px 16px; text-align: center; color: #64748b; font-size: 13px; }
.toast, .banner { margin: 0; padding: 8px 20px; font-size: 13px; }
.toast { background: #eff6ff; color: #1d4ed8; }
.banner { background: #fef2f2; color: #991b1b; }

.btn {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}
.btn:disabled { opacity: .5; cursor: not-allowed; }
.primary { background: #2563eb; color: #fff; }
.ghost { background: #fff; color: #334155; border-color: #cbd5e1; }

.overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, .4);
}
.modal {
  width: min(640px, 100%);
  max-height: min(82vh, 720px);
  overflow: auto;
  background: #fff;
  border-radius: 14px;
  padding: 16px 18px 18px;
}
.modal header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.modal h3 { margin: 0; font-size: 16px; }
.icon { width: 32px; height: 32px; border: 0; background: transparent; font-size: 22px; cursor: pointer; }

.form, .detail { display: flex; flex-direction: column; gap: 10px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 650; color: #334155; }
input, textarea, pre {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-weight: 400;
  color: #0f172a;
}
pre { font-size: 12px; background: #f8fafc; overflow: auto; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.actions { display: flex; gap: 8px; }
.lead { margin: 0; font-weight: 700; }
.body, .detail p { margin: 0; color: #334155; font-size: 14px; line-height: 1.5; }
.meta { color: #64748b !important; font-size: 12px !important; }

.findings { margin: 0; padding: 0; list-style: none; }
.findings li { padding: 8px 0; border-top: 1px solid #e2e8f0; }
.findings strong { margin-right: 8px; }
.findings .fail { color: #b91c1c; font-size: 12px; font-weight: 700; }
.findings .pass { color: #15803d; font-size: 12px; font-weight: 700; }
.findings p { margin: 4px 0 0; font-size: 13px; }
</style>
