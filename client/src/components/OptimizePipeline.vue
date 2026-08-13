<script setup lang="ts">
import { onMounted } from 'vue'
import { useOptimizePipeline, type OptimizePipelineProps } from './optimizePipeline.model'

const props = withDefaults(defineProps<OptimizePipelineProps>(), {
  companyId: '',
  agentName: 'Voice AI Agent',
})

const {
  STEPS,
  phase,
  selectedView,
  error,
  toast,
  saving,
  findings,
  loadingFindings,
  calls,
  patterns,
  testCases,
  selectedIds,
  runResults,
  runMetrics,
  recommendations,
  navItems,
  alreadyOptimized,
  modalKind,
  modalItem,
  draft,
  currentHint,
  progressPercent,
  progressLabel,
  allSelected,
  criteria,
  canEditTests,
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
} = useOptimizePipeline(props)

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
        data-testid="optimize-start"
        :disabled="!agentId || !locationId"
        @click="startOptimize"
      >
        {{ alreadyOptimized || phase === 'done' ? 'Run again' : 'Optimize this agent' }}
      </button>
    </header>

    <div class="progress" aria-label="Optimize progress" data-testid="optimize-progress">
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
          :data-testid="`nav-${step.view}`"
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

        <div v-if="isViewBusy" class="working" data-testid="optimize-working">
          <p>Working on this step…</p>
          <span>Awaiting for results.</span>
        </div>

        <div v-else-if="selectedView === 'run'" class="metrics">
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

        <div v-if="!isViewBusy" class="rows">
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

.working {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 40px 16px;
  color: #6b7280;
  text-align: center;
}

.working p {
  margin: 0;
  color: #111827;
  font-size: 14px;
  font-weight: 600;
}

.working span { font-size: 12px; }

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
