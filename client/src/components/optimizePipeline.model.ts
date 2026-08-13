import { computed, ref } from 'vue'

export type Phase = 'idle' | 'running' | 'select' | 'finishing' | 'done' | 'blocked' | 'error'
export type StepId = 'sync_agent' | 'sync_calls' | 'rubric' | 'evaluate' | 'patterns' | 'tests' | 'run' | 'recs'
export type ViewId = 'calls' | 'rubric' | 'evaluate' | 'patterns' | 'tests' | 'run' | 'recs'
export type ModalKind = ViewId | null

export interface StepDef {
  id: StepId
  view?: ViewId
  label: string
  hint: string
  accent: string
}

export interface OptimizePipelineProps {
  agentId: string
  locationId: string
  companyId?: string
  agentName?: string
}

export const STEPS: StepDef[] = [
  { id: 'sync_agent', label: 'Sync', hint: 'Pull the latest agent configuration', accent: '#93c5fd' },
  { id: 'sync_calls', view: 'calls', label: 'Calls', hint: 'Recent conversations from HighLevel', accent: '#60a5fa' },
  { id: 'rubric', view: 'rubric', label: 'Rubric', hint: 'Evaluation criteria from the prompt', accent: '#3b82f6' },
  { id: 'evaluate', view: 'evaluate', label: 'Analyze', hint: 'How each call scored', accent: '#2563eb' },
  { id: 'patterns', view: 'patterns', label: 'Issues', hint: 'Repeating failure patterns', accent: '#1d4ed8' },
  { id: 'tests', view: 'tests', label: 'Tests', hint: 'Choose which tests to run. Click a row to edit.', accent: '#1e40af' },
  { id: 'run', view: 'run', label: 'Run', hint: 'Simulated test outcomes', accent: '#1e3a8a' },
  { id: 'recs', view: 'recs', label: 'Recommend', hint: 'Suggested prompt and action changes', accent: '#172554' },
]

export const AUTO_STEPS: StepId[] = ['sync_agent', 'sync_calls', 'rubric', 'evaluate', 'patterns', 'tests']

export function formatWhen(value: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return 'recently'
  }
}

export function formatKey(value = '') {
  return String(value).replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim()
    .split(' ').map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
}

export function formatDate(value?: string) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  } catch {
    return '—'
  }
}

export function personaOf(item: any) {
  const raw = item?.persona
  if (!raw) return {}
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return {} }
  }
  return raw
}

export function recTitle(rec: any) {
  return formatKey(rec.recType || rec.rec_type || 'Recommendation')
}

export function recBody(rec: any) {
  return rec.rationale || rec.payload?.summary || 'Suggested change for this agent.'
}

export function useOptimizePipeline(props: OptimizePipelineProps, fetchImpl: typeof fetch = fetch) {
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
  const version = ref<{ id: string, label: string, number?: number, createdAt?: string } | null>(null)
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
    if (phase.value === 'blocked') return `${progressPercent.value}% · no data`
    return `${progressPercent.value}%`
  })
  const selectedTests = computed(() => testCases.value.filter((item) => selectedIds.value.includes(item.id)))
  const allSelected = computed(() => testCases.value.length > 0 && selectedIds.value.length === testCases.value.length)
  const criteria = computed(() => rubric.value?.criteria || [])
  const canEditTests = computed(() => phase.value === 'select' || phase.value === 'idle' || phase.value === 'done')
  const passedCount = computed(() => runResults.value.filter((item) => item.passed).length)
  const isViewBusy = computed(() => {
    if (phase.value !== 'running' && phase.value !== 'finishing') return false
    const step = STEPS.find((item) => item.view === selectedView.value)
    return Boolean(step && currentStep.value === step.id && !doneSteps.value.includes(step.id))
  })
  const versionLine = computed(() => {
    const number = version.value?.number
    if (!number) return ''
    return `Version ${number}`
  })

  function stepCount(step: StepDef) {
    if (step.view === 'calls' || step.view === 'evaluate') return calls.value.length
    if (step.view === 'rubric') return criteria.value.length
    if (step.view === 'patterns') return patterns.value.length
    if (step.view === 'tests') return testCases.value.length
    if (step.view === 'run') return runResults.value.length
    if (step.view === 'recs') return recommendations.value.length
    return 0
  }

  function stepState(id: StepId) {
    if (doneSteps.value.includes(id)) return 'done'
    if (currentStep.value === id) return 'current'
    return 'todo'
  }

  function stepSummary(step: StepDef) {
    const state = stepState(step.id)
    if (state === 'current' && (phase.value === 'running' || phase.value === 'finishing')) return currentHint.value || 'Working…'
    if (state === 'todo') return 'No data'
    if (step.id === 'sync_agent') return 'Agent synced'
    if (step.view === 'tests' && phase.value === 'select') {
      return `${selectedIds.value.length} of ${testCases.value.length} selected`
    }
    if (step.view === 'run' && runResults.value.length) {
      return `${passedCount.value} passed · ${runResults.value.length - passedCount.value} failed`
    }
    const count = stepCount(step)
    if (!count) return state === 'done' ? 'Done' : 'No data'
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
    const response = await fetchImpl(path, {
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

  function clearStepData(step: StepId) {
    if (step === 'sync_calls') calls.value = []
    if (step === 'rubric') rubric.value = null
    if (step === 'patterns') patterns.value = []
    if (step === 'tests') {
      testCases.value = []
      selectedIds.value = []
    }
    if (step === 'run') {
      runResults.value = []
      applyRunMetrics({}, [])
    }
    if (step === 'recs') recommendations.value = []
  }

  async function runStep(step: StepId, extra: Record<string, unknown> = {}) {
    currentStep.value = step
    clearStepData(step)
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

  function closeModal() {
    modalKind.value = null
    modalItem.value = null
    findings.value = []
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
    calls.value = []
    rubric.value = null
    patterns.value = []
    testCases.value = []
    runResults.value = []
    recommendations.value = []
    applyRunMetrics({}, [])
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
          doneSteps.value = doneSteps.value.filter((id) => id !== 'tests')
        }
      }
      currentStep.value = 'tests'
      selectedView.value = 'tests'
      phase.value = 'select'
      toast.value = ''
    } catch (err: any) {
      phase.value = 'error'
      error.value = err.message || 'Optimize failed'
      currentStep.value = null
    }
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
      const data = await fetchImpl(`/api/analysis/findings/${callId}`).then((res) => res.json()).catch(() => ({}))
      findings.value = data.findings || []
    } finally {
      loadingFindings.value = false
    }
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
      toast.value = ''
      await loadStatus()
    } catch (err: any) {
      phase.value = 'error'
      error.value = err.message || 'Could not finish optimization'
      currentStep.value = null
    }
  }

  return {
    STEPS,
    phase,
    currentStep,
    selectedView,
    doneSteps,
    error,
    toast,
    saving,
    loadingFindings,
    findings,
    calls,
    rubric,
    patterns,
    testCases,
    selectedIds,
    runResults,
    runMetrics,
    recommendations,
    navItems,
    version,
    lastOptimizedAt,
    alreadyOptimized,
    modalKind,
    modalItem,
    draft,
    currentHint,
    processedCount,
    progressPercent,
    progressLabel,
    selectedTests,
    allSelected,
    criteria,
    canEditTests,
    passedCount,
    isViewBusy,
    versionLine,
    stepState,
    stepSummary,
    canOpenStep,
    openStep,
    loadStatus,
    startOptimize,
    openModal,
    closeModal,
    isSelected,
    toggleSelect,
    selectAll,
    selectNone,
    saveTest,
    continueAfterReview,
    runDuration,
    recTitle,
    recBody,
    formatDate,
    formatKey,
  }
}

export type OptimizePipelineApi = ReturnType<typeof useOptimizePipeline>
