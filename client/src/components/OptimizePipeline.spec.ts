import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_STEPS, STEPS, formatDate, formatKey, personaOf, recBody, recTitle, useOptimizePipeline } from './optimizePipeline.model'

type Json = Record<string, unknown>

function jsonResponse(body: Json, ok = true, status = ok ? 200 : 400) {
  return Promise.resolve({
    ok,
    status,
    json: async () => body,
  } as Response)
}

function stepPayload(step: string): Json {
  const calls = [
    { id: 'call-1', summary: 'Booked a visit', kind: 'real', duration_s: 42, created_at_ghl: '2026-08-14T10:00:00.000Z' },
  ]
  const tests = [
    { id: 'test-1', title: 'Happy booking', kind: 'happy_path', scenario: 'Caller books', persona: { name: 'Ann', needs: 'book', communication_style: 'calm' } },
    { id: 'test-2', title: 'Price pushback', kind: 'edge_case', scenario: 'Caller objects', persona: { name: 'Bob' } },
  ]

  switch (step) {
    case 'sync_agent':
      return { success: true, step, agentCount: 1 }
    case 'sync_calls':
      return { success: true, step, count: calls.length, calls, blocked: false }
    case 'rubric':
      return {
        success: true,
        step,
        versionId: 'ver-1',
        rubric: { id: 'rub-1', criteria: [{ id: 'crit-1', key: 'greeting', category: 'opening', checkType: 'llm', severity: 2 }] },
      }
    case 'evaluate':
      return { success: true, step, evaluated: 1, calls }
    case 'patterns':
      return { success: true, step, patternCount: 1, patterns: [{ id: 'pat-1', title: 'Caves on price', fail_count: 2, call_count: 4, impact_score: 1.4 }] }
    case 'tests':
      return { success: true, step, totalCases: 2, testCases: tests }
    case 'run':
      return {
        success: true,
        step,
        totalTests: 1,
        totalPassed: 1,
        totalFailed: 0,
        passRate: 100,
        startedAt: '2026-08-14T10:00:00.000Z',
        finishedAt: '2026-08-14T10:01:10.000Z',
        results: [{ id: 'res-1', test_case_id: 'test-1', test_case_title: 'Happy booking', passed: true, attempt: 1 }],
      }
    case 'recs':
      return {
        success: true,
        step,
        versionId: 'ver-1',
        accepted: 1,
        recommendations: [{ id: 'rec-1', recType: 'prompt_patch', rationale: 'Tighten the pricing reply' }],
      }
    default:
      return { success: true, step }
  }
}

function mockFetch(options: {
  status?: Json
  stepOverrides?: Record<string, Json | (() => Json | Promise<Json>)>
  failStep?: string
  noCalls?: boolean
} = {}) {
  let generatedRecs: any[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/optimize/status/')) {
      const finished = generatedRecs.length > 0
      return jsonResponse({
        success: true,
        version: { id: 'ver-1', label: 'baseline' },
        lastOptimizedAt: finished ? '2026-08-14T12:00:00.000Z' : null,
        calls: [],
        rubric: null,
        testCases: [],
        patterns: [],
        lastRunResults: [],
        lastRunMetrics: null,
        ...options.status,
        recommendations: (options.status?.recommendations as any[]) || generatedRecs,
        optimized: Boolean(options.status?.optimized) || finished,
      })
    }
    if (url.includes('/api/optimize/step')) {
      const body = JSON.parse(String(init?.body || '{}'))
      const step = String(body.step || '')
      if (options.failStep === step) return jsonResponse({ success: false, error: `${step} failed` }, false, 500)
      if (options.noCalls && step === 'sync_calls') {
        return jsonResponse({ success: true, step, count: 0, calls: [], blocked: true, reason: 'no_calls' })
      }
      const override = options.stepOverrides?.[step]
      const payload = typeof override === 'function' ? await override() : override
      const bodyOut = payload || stepPayload(step)
      if (step === 'recs' && Array.isArray(bodyOut.recommendations)) {
        generatedRecs = bodyOut.recommendations as any[]
      }
      return jsonResponse(bodyOut)
    }
    if (url.includes('/api/tests/') && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body || '{}'))
      return jsonResponse({ success: true, testCase: { id: 'test-1', ...body } })
    }
    if (url.includes('/api/analysis/findings/')) {
      return jsonResponse({ success: true, findings: [{ id: 'f1', criterion_key: 'greeting', status: 'fail', rationale: 'Skipped the greeting' }] })
    }
    return jsonResponse({ success: false, error: `Unhandled ${url}` }, false, 404)
  })
  return fetchMock as unknown as typeof fetch
}

function createPipeline(fetchImpl: typeof fetch, props: Partial<{ agentId: string, locationId: string, companyId: string, agentName: string }> = {}) {
  return useOptimizePipeline({
    agentId: 'agt-1',
    locationId: 'loc-1',
    companyId: 'co-1',
    agentName: 'Maya',
    ...props,
  }, fetchImpl)
}

describe('OptimizePipeline flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defines the locked pipeline shape', () => {
    expect(AUTO_STEPS).toEqual(['sync_agent', 'sync_calls', 'rubric', 'evaluate', 'patterns', 'tests'])
    expect(STEPS.map((step) => step.id)).toEqual(['sync_agent', 'sync_calls', 'rubric', 'evaluate', 'patterns', 'tests', 'run', 'recs'])
    expect(STEPS.filter((step) => step.view).map((step) => step.label)).toEqual([
      'Calls', 'Rubric', 'Analyze', 'Issues', 'Tests', 'Run', 'Recommend',
    ])
  })

  it('starts idle at 0% and blocks start without a location', async () => {
    const pipeline = createPipeline(mockFetch(), { locationId: '' })
    expect(pipeline.phase.value).toBe('idle')
    expect(pipeline.progressPercent.value).toBe(0)
    expect(pipeline.progressLabel.value).toBe('0%')
    await pipeline.startOptimize()
    expect(pipeline.phase.value).toBe('error')
    expect(pipeline.error.value).toMatch(/Missing agent or location/)
  })

  it('loads an already optimized version from status', async () => {
    const pipeline = createPipeline(mockFetch({
      status: {
        optimized: true,
        lastOptimizedAt: '2026-08-14T12:00:00.000Z',
        version: { id: 'ver-1', label: 'baseline' },
        recommendations: [{ id: 'rec-1', recType: 'prompt_patch', rationale: 'Tighten the pricing reply' }],
        lastRunResults: [{ id: 'res-1', passed: true }],
        lastRunMetrics: { total: 2, passed: 1, failed: 1, passRate: 50 },
      },
    }))
    await pipeline.loadStatus()
    expect(pipeline.alreadyOptimized.value).toBe(true)
    expect(pipeline.versionLine.value).toMatch(/Version baseline · optimized/)
    expect(pipeline.progressPercent.value).toBe(100)
    expect(pipeline.progressLabel.value).toBe('100% · run complete')
    expect(pipeline.selectedView.value).toBe('recs')
    expect(pipeline.runMetrics.value).toMatchObject({ total: 2, passed: 1, failed: 1, passRate: 50 })
    expect(pipeline.navItems.value).toHaveLength(7)
  })

  it('runs auto steps in order and pauses for test selection with none selected', async () => {
    const fetchImpl = mockFetch()
    const pipeline = createPipeline(fetchImpl)
    await pipeline.startOptimize()

    const steps = vi.mocked(fetchImpl).mock.calls
      .filter((call) => String(call[0]).includes('/api/optimize/step'))
      .map((call) => JSON.parse(String(call[1]?.body)).step)

    expect(steps).toEqual(AUTO_STEPS)
    expect(pipeline.phase.value).toBe('select')
    expect(pipeline.selectedView.value).toBe('tests')
    expect(pipeline.selectedIds.value).toEqual([])
    expect(pipeline.testCases.value).toHaveLength(2)
    expect(pipeline.toast.value).toMatch(/Select the tests/)
    expect(pipeline.progressLabel.value).toMatch(/choose tests to continue/)
    expect(pipeline.doneSteps.value).not.toContain('tests')
    expect(pipeline.currentStep.value).toBe('tests')
  })

  it('sends agent, location and company on every step', async () => {
    const fetchImpl = mockFetch()
    const pipeline = createPipeline(fetchImpl)
    await pipeline.startOptimize()
    const first = vi.mocked(fetchImpl).mock.calls.find((call) => String(call[0]).includes('/api/optimize/step'))
    expect(first).toBeTruthy()
    expect(JSON.parse(String(first![1]?.body))).toMatchObject({
      agentId: 'agt-1',
      locationId: 'loc-1',
      companyId: 'co-1',
      step: 'sync_agent',
    })
  })

  it('blocks when HighLevel returns no calls', async () => {
    const pipeline = createPipeline(mockFetch({ noCalls: true }))
    await pipeline.startOptimize()
    expect(pipeline.phase.value).toBe('blocked')
    expect(pipeline.selectedView.value).toBe('calls')
    expect(pipeline.progressLabel.value).toMatch(/waiting on calls/)
    expect(pipeline.testCases.value).toEqual([])
  })

  it('stops the pipeline when a later step fails', async () => {
    const pipeline = createPipeline(mockFetch({ failStep: 'patterns' }))
    await pipeline.startOptimize()
    expect(pipeline.phase.value).toBe('error')
    expect(pipeline.error.value).toBe('patterns failed')
    expect(pipeline.currentStep.value).toBeNull()
  })

  it('hides stale data while the current section is in progress', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchImpl = mockFetch({
      status: { testCases: [{ id: 'old', title: 'Old leftover test' }] },
      stepOverrides: {
        tests: async () => {
          await gate
          return stepPayload('tests')
        },
      },
    })
    const pipeline = createPipeline(fetchImpl)
    await pipeline.loadStatus()
    expect(pipeline.testCases.value[0].title).toBe('Old leftover test')

    const running = pipeline.startOptimize()
    await vi.waitFor(() => {
      expect(pipeline.selectedView.value).toBe('tests')
      expect(pipeline.phase.value).toBe('running')
    })
    expect(pipeline.testCases.value).toEqual([])
    expect(pipeline.isViewBusy.value).toBe(true)

    release()
    await running
    expect(pipeline.isViewBusy.value).toBe(false)
    expect(pipeline.testCases.value.map((item) => item.title)).toEqual(['Happy booking', 'Price pushback'])
  })

  it('does not run tests until at least one is selected', async () => {
    const fetchImpl = mockFetch()
    const pipeline = createPipeline(fetchImpl)
    await pipeline.startOptimize()
    await pipeline.continueAfterReview()
    expect(pipeline.error.value).toBe('Select at least one test to run.')
    const ran = vi.mocked(fetchImpl).mock.calls.some((call) => (
      String(call[0]).includes('/api/optimize/step') && String(call[1]?.body || '').includes('"step":"run"')
    ))
    expect(ran).toBe(false)
    expect(pipeline.phase.value).toBe('select')
  })

  it('selects and clears all tests', async () => {
    const pipeline = createPipeline(mockFetch())
    await pipeline.startOptimize()
    pipeline.selectAll()
    expect(pipeline.selectedIds.value).toEqual(['test-1', 'test-2'])
    expect(pipeline.allSelected.value).toBe(true)
    pipeline.selectNone()
    expect(pipeline.selectedIds.value).toEqual([])
    pipeline.toggleSelect('test-2')
    expect(pipeline.isSelected('test-2')).toBe(true)
    pipeline.toggleSelect('test-2')
    expect(pipeline.isSelected('test-2')).toBe(false)
  })

  it('runs only selected tests and records metrics plus recommendations', async () => {
    const fetchImpl = mockFetch()
    const pipeline = createPipeline(fetchImpl)
    await pipeline.startOptimize()
    pipeline.toggleSelect('test-1')
    await pipeline.continueAfterReview()

    const runCall = vi.mocked(fetchImpl).mock.calls.find((call) => (
      String(call[0]).includes('/api/optimize/step') && String(call[1]?.body || '').includes('"step":"run"')
    ))
    expect(JSON.parse(String(runCall?.[1]?.body)).testCaseIds).toEqual(['test-1'])
    expect(pipeline.phase.value).toBe('done')
    expect(pipeline.selectedView.value).toBe('recs')
    expect(pipeline.recommendations.value.map((item) => item.rationale)).toContain('Tighten the pricing reply')
    expect(pipeline.runMetrics.value).toMatchObject({ total: 1, passed: 1, failed: 0, passRate: 100 })
    expect(pipeline.runDuration()).toBe('1m 10s')
    expect(pipeline.progressPercent.value).toBe(100)
    expect(pipeline.alreadyOptimized.value).toBe(true)
  })

  it('saves an edited test case and updates the list', async () => {
    const fetchImpl = mockFetch()
    const pipeline = createPipeline(fetchImpl)
    await pipeline.startOptimize()
    pipeline.openModal('tests', pipeline.testCases.value[0])
    expect(pipeline.modalKind.value).toBe('tests')
    expect(pipeline.draft.value.title).toBe('Happy booking')
    pipeline.draft.value.title = 'Updated booking path'
    await pipeline.saveTest()
    expect(pipeline.toast.value).toBe('Test case saved')
    expect(pipeline.modalKind.value).toBeNull()
    expect(pipeline.testCases.value[0].title).toBe('Updated booking path')
    const saveCall = vi.mocked(fetchImpl).mock.calls.find((call) => (
      String(call[0]).includes('/api/tests/test-1') && call[1]?.method === 'PUT'
    ))
    expect(JSON.parse(String(saveCall?.[1]?.body)).title).toBe('Updated booking path')
  })

  it('loads findings when a call row is opened', async () => {
    const fetchImpl = mockFetch()
    const pipeline = createPipeline(fetchImpl)
    await pipeline.startOptimize()
    pipeline.openModal('calls', pipeline.calls.value[0])
    await vi.waitFor(() => {
      expect(pipeline.findings.value[0]?.rationale).toBe('Skipped the greeting')
    })
  })

  it('keeps future sections locked until they have data', async () => {
    const pipeline = createPipeline(mockFetch())
    await pipeline.loadStatus()
    const recs = STEPS.find((step) => step.id === 'recs')!
    expect(pipeline.canOpenStep(recs)).toBe(false)
    pipeline.openStep(recs)
    expect(pipeline.selectedView.value).toBe('calls')
  })

  it('allows opening completed sections after the pause', async () => {
    const pipeline = createPipeline(mockFetch())
    await pipeline.startOptimize()
    const calls = STEPS.find((step) => step.id === 'sync_calls')!
    expect(pipeline.canOpenStep(calls)).toBe(true)
    pipeline.openStep(calls)
    expect(pipeline.selectedView.value).toBe('calls')
    expect(pipeline.calls.value[0].summary).toBe('Booked a visit')
  })

  it('formats helpers used by the UI', () => {
    expect(formatKey('prompt_patch')).toBe('Prompt Patch')
    expect(recTitle({ recType: 'action_update' })).toBe('Action Update')
    expect(recBody({ rationale: 'Do this' })).toBe('Do this')
    expect(personaOf({ persona: '{"name":"Ann"}' }).name).toBe('Ann')
    expect(formatDate('')).toBe('—')
  })
})
