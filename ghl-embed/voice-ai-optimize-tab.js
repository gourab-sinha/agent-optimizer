/**
 * Agent Optimizer — Voice AI editor tab
 *
 * Vue-safe: HighLevel's Voice AI (ai-employees) app uses Pinia + Vue Router.
 * Calling AppUtils or mutating Vue-owned DOM during agent setup throws:
 *   SyntaxError: Need to install with `app.use` function
 *
 * Rules this script follows:
 *   - Never call AppUtils during route transitions or from a raw MutationObserver
 *   - Detect pages from window.location only until the editor has settled
 *   - Do not insert nodes into HighLevel Vue trees (tab + panel live on body)
 *   - Wait SETTLE_MS after navigation before reading AppUtils / resolve
 *
 * INSTALL
 *   1. Set CONFIG.appUrl (no trailing slash)
 *   2. Agency View → Settings → Company → Custom JavaScript → paste this file
 *
 * Identity is still verified by POST /api/embed/resolve before the tab shows.
 */
(function agentOptimizerVoiceAiTab() {
  'use strict';

  var CONFIG = Object.assign({
    appUrl: 'https://e27b-2401-4900-c12b-6eb6-54fb-395b-2a72-4344.ngrok-free.app',
    tabLabel: 'Optimize',
    tabId: 'ao-optimize-tab',
    panelId: 'ao-optimize-panel',
    appId: '',
    debug: false,
    settleMs: 600
  }, window.AO_CONFIG || {});

  var STYLE_ID = 'ao-optimize-styles';
  var ACTIVE_ATTR = 'data-ao-active';
  var SETTLE_MS = Number(CONFIG.settleMs) || 600;

  var state = {
    active: false,
    companyId: '',
    locationId: '',
    locationName: '',
    userId: '',
    agentId: '',
    agentName: '',
    ssoKey: '',
    iframeUrl: '',
    resolveReason: '',
    lastHref: '',
    lastResolveKey: '',
    lastResolveAllowed: false,
    resolveInFlight: false
  };

  var settleTimer = null;
  var positionTimer = null;

  function log() {
    if (!CONFIG.debug) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[AgentOptimizer]');
    console.log.apply(console, args);
  }

  function warn() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[AgentOptimizer]');
    console.warn.apply(console, args);
  }

  function pageUrl() {
    return String(window.location.pathname || '') + String(window.location.hash || '');
  }

  function pageHref() {
    return String(window.location.href || '');
  }

  function isVoiceAiSurfaceFromUrl() {
    var hay = pageUrl().toLowerCase();
    var hints = [
      'voice-ai',
      'voiceai',
      'voice_ai',
      'ai-agents',
      'ai_agents',
      'conversation-ai',
      'agent-studio',
      'super-agent',
      'superagent',
      'ai-employee',
      'aiemployee',
      'ai-employees'
    ];
    for (var i = 0; i < hints.length; i++) {
      if (hay.indexOf(hints[i]) !== -1) return true;
    }
    return false;
  }

  function isBuilderPage() {
    return pageUrl().toLowerCase().indexOf('/builder/') !== -1;
  }

  function isAgentListPage() {
    var href = pageHref().toLowerCase();
    var path = pageUrl().toLowerCase();
    if (isBuilderPage()) return false;
    if (href.indexOf('view=agent-list') !== -1) return true;
    if (/\/ai-agents\/voice-ai\/?$/.test(path)) return true;
    if (/\/voice-ai\/?$/.test(path)) return true;
    return false;
  }

  function getBuilderTab() {
    try {
      return String(new URLSearchParams(window.location.search).get('builderTab') || '').toLowerCase();
    } catch (err) {
      return '';
    }
  }

  function setBuilderTab(name) {
    try {
      var url = new URL(window.location.href);
      if (name) url.searchParams.set('builderTab', name);
      else url.searchParams.delete('builderTab');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch (err) {
      log('setBuilderTab failed', err);
    }
  }

  function extractLocationIdFromUrl() {
    var match = pageUrl().match(/\/location\/([A-Za-z0-9]+)/i);
    return match ? match[1] : '';
  }

  function extractAgentIdFromUrl() {
    var search = new URLSearchParams(window.location.search || '');
    if (search.get('agentId')) return search.get('agentId');
    if (search.get('agent_id')) return search.get('agent_id');

    var path = pageUrl().split('?')[0];
    var reserved = /^(edit|new|create|list|build|builder|deploy|optimize|voice-ai|voiceai|ai-agents|agents|agent)$/i;
    var patterns = [
      /voice-ai\/builder\/([A-Za-z0-9_-]{8,})/i,
      /\/builder\/([A-Za-z0-9_-]{8,})/i,
      /voice-ai(?:-agents)?\/(?:agent\/)?([A-Za-z0-9_-]{8,})/i,
      /ai-employees?\/(?:agent\/)?([A-Za-z0-9_-]{8,})/i,
      /ai-agents\/[^/]+\/([A-Za-z0-9_-]{8,})/i,
      /agents\/([A-Za-z0-9_-]{8,})/i,
      /agent\/([A-Za-z0-9_-]{8,})/i
    ];
    for (var p = 0; p < patterns.length; p++) {
      var match = path.match(patterns[p]);
      if (match && match[1] && !reserved.test(match[1])) {
        return match[1];
      }
    }
    var last = path.split('/').filter(Boolean).pop() || '';
    return last.length >= 8 && !reserved.test(last) ? last : '';
  }

  function textOf(el) {
    return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function labelIs(el, label) {
    return textOf(el).toLowerCase() === String(label).toLowerCase();
  }

  function findControl(label) {
    var nodes = document.querySelectorAll('button, [role="tab"], [role="button"], a');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === CONFIG.tabId) continue;
      if (labelIs(nodes[i], label)) return nodes[i];
    }
    return null;
  }

  function findBuildDeploy() {
    var build = document.querySelector('[data-testid="tab-build"]') || findControl('build');
    var deploy = document.querySelector('[data-testid="tab-deploy"]') || findControl('deploy');
    if (!build || !deploy) return null;
    return { build: build, deploy: deploy };
  }

  function getBuildLayout() {
    return document.querySelector('[data-testid="builder-build-layout"]')
      || document.getElementById('builder-build-layout');
  }

  function inactiveTabClass(build) {
    return String(build.className || '')
      .replace(/text-blue-600/g, 'text-gray-600')
      .replace(/aria-pressed="true"/g, '');
  }

  function editorIsReady() {
    if (!isVoiceAiSurfaceFromUrl()) return false;
    if (isAgentListPage()) return true;
    return !!findBuildDeploy();
  }

  function safeGetRoute() {
    return {};
  }

  function extractAgentId(route) {
    route = route || {};
    var params = route.params || {};
    var keys = ['agentId', 'agent_id', 'id', 'voiceAiAgentId', 'voiceAIAgentId'];
    for (var i = 0; i < keys.length; i++) {
      if (params[keys[i]] && String(params[keys[i]]).length >= 8) {
        return String(params[keys[i]]);
      }
    }
    var query = route.query || {};
    if (query.agentId) return String(query.agentId);
    if (query.agent_id) return String(query.agent_id);
    return extractAgentIdFromUrl();
  }

  function extractAgentName() {
    var heading = document.querySelector('h1, h2');
    var name = textOf(heading);
    if (name && !/voice ai|ai agents|ai employee|build|deploy/i.test(name) && name.length < 80 && name.indexOf('.') === -1) {
      return name;
    }
    return '';
  }

  function readAppUtils(method) {
    try {
      if (!window.AppUtils || !AppUtils.Utilities || !AppUtils.Utilities[method]) return null;
      return AppUtils.Utilities[method]();
    } catch (err) {
      log(method + ' skipped (Vue not ready)', err && err.message);
      return null;
    }
  }

  function collectUnsignedContext() {
    return Promise.resolve({
      companyId: '',
      locationId: extractLocationIdFromUrl(),
      locationName: '',
      userId: '',
      agentId: extractAgentIdFromUrl(),
      agentName: extractAgentName(),
      route: {
        fullPath: pageUrl(),
        path: window.location.pathname,
        name: '',
        params: {},
        query: {}
      }
    });
  }

  function resolveSsoKey() {
    if (!CONFIG.appId || typeof window.exposeSessionDetails !== 'function') {
      return Promise.resolve('');
    }
    try {
      return Promise.resolve(window.exposeSessionDetails(CONFIG.appId)).catch(function () {
        return '';
      });
    } catch (err) {
      return Promise.resolve('');
    }
  }

  function resolveContextWithBackend(unsigned, ssoKey) {
    // Never fetch() from app.gohighlevel.com → your app origin.
    // The browser treats that as CORS; ngrok free often omits ACAO.
    // Identity is verified inside the iframe (same origin as /api).
    var params = new URLSearchParams();
    params.set('embed', '1');
    if (unsigned.companyId) params.set('companyId', unsigned.companyId);
    if (unsigned.locationId) params.set('locationId', unsigned.locationId);
    if (unsigned.userId) params.set('userId', unsigned.userId);
    if (unsigned.agentId) params.set('agentId', unsigned.agentId);
    if (unsigned.agentName) params.set('agentName', unsigned.agentName);
    if (ssoKey) params.set('ssoKey', ssoKey);
    return Promise.resolve({
      show: !!(unsigned.locationId || unsigned.agentId),
      reason: unsigned.locationId ? 'ok' : 'missing_location',
      companyId: unsigned.companyId,
      locationId: unsigned.locationId,
      userId: unsigned.userId,
      agentId: unsigned.agentId,
      agent: unsigned.agentId ? {
        id: unsigned.agentId,
        name: unsigned.agentName,
        locationId: unsigned.locationId
      } : null,
      iframeUrl: String(CONFIG.appUrl || '').replace(/\/+$/, '') + '/?' + params.toString()
    });
  }

  function appOrigin() {
    try {
      return new URL(CONFIG.appUrl).origin;
    } catch (err) {
      return '';
    }
  }

  function buildIframeSrc() {
    if (state.iframeUrl) return state.iframeUrl;
    var url = String(CONFIG.appUrl || '').replace(/\/+$/, '');
    var params = new URLSearchParams();
    params.set('embed', '1');
    if (state.companyId) params.set('companyId', state.companyId);
    if (state.agentId) params.set('agentId', state.agentId);
    if (state.locationId) params.set('locationId', state.locationId);
    if (state.agentName) params.set('agentName', state.agentName);
    if (state.ssoKey) params.set('ssoKey', state.ssoKey);
    return url + '/?' + params.toString();
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + CONFIG.tabId + '{',
      '  display:none;box-sizing:border-box;pointer-events:auto !important;cursor:pointer;',
      '  font-family:inherit;',
      '}',
      '#' + CONFIG.tabId + '[data-ao-ready="true"]{display:inline-flex;}',
      '#' + CONFIG.tabId + '[' + ACTIVE_ATTR + '="true"]{',
      '  background:#fff !important;color:#2563eb !important;',
      '  box-shadow:0 1px 2px rgba(16,24,40,.08);',
      '}',
      '#' + CONFIG.tabId + '[' + ACTIVE_ATTR + '="false"]{',
      '  background:#dde0e6 !important;color:#374151 !important;box-shadow:none;',
      '}',
      '#' + CONFIG.panelId + '{display:none;background:#fff;overflow:hidden;}',
      '#' + CONFIG.panelId + '[' + ACTIVE_ATTR + '="true"]{display:block;}',
      '#' + CONFIG.panelId + ' iframe{',
      '  position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;display:block;',
      '}',
      '#' + CONFIG.panelId + ' .ao-missing{',
      '  max-width:520px;margin:80px auto;padding:24px;background:#fff;',
      '  border:1px solid #e2e8f0;border-radius:12px;color:#0f172a;',
      '  font-family:inherit;line-height:1.5;',
      '}'
    ].join('');
    document.head.appendChild(style);
  }

  function sidebarOffset() {
    var selectors = ['aside', 'nav[class*="sidebar"]', '[class*="Sidebar"]'];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (!el) continue;
      var rect = el.getBoundingClientRect();
      if (rect.left <= 8 && rect.width > 80 && rect.width < 420 && rect.height > 200) {
        return Math.round(rect.right);
      }
    }
    return 0;
  }

  function styleOptimizeTab(tab, active) {
    if (!tab) return;
    tab.className = 'builder-tab-btn relative z-[1] flex cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 px-4 py-1.5 text-sm font-medium transition-colors duration-200';
    tab.setAttribute(ACTIVE_ATTR, active ? 'true' : 'false');
    tab.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (active) document.body.classList.add('ao-optimize-on');
    else document.body.classList.remove('ao-optimize-on');
  }

  function positionFloatingTab() {
    var tab = document.getElementById(CONFIG.tabId);
    if (!tab) return;
    tab.style.position = 'fixed';
    tab.style.zIndex = '9991';
    tab.style.minWidth = '0';
    tab.style.overflow = 'hidden';
    var sw = document.querySelector('[data-testid="builder-tab-switch"]');
    if (sw) {
      var box = sw.getBoundingClientRect();
      tab.style.top = Math.round(box.top) + 'px';
      tab.style.left = Math.round(box.right + 8) + 'px';
      tab.style.height = Math.round(box.height) + 'px';
      tab.style.width = 'auto';
      tab.style.padding = '0 14px';
      tab.style.borderRadius = '8px';
      tab.style.right = 'auto';
      styleOptimizeTab(tab, state.active);
      return;
    }
    tab.style.top = '72px';
    tab.style.right = '24px';
    tab.style.left = 'auto';
  }

  function restoreBuildLayout() {}

  function getOverlayBox() {
    var layout = getBuildLayout();
    if (layout) {
      var box = layout.getBoundingClientRect();
      if (box.width > 80 && box.height > 80) return box;
    }
    var sw = document.querySelector('[data-testid="builder-tab-switch"]');
    var top = 128;
    var left = sidebarOffset();
    if (sw) top = Math.round(sw.getBoundingClientRect().bottom + 8);
    return {
      top: top,
      left: left,
      width: Math.max(320, window.innerWidth - left),
      height: Math.max(240, window.innerHeight - top)
    };
  }

  function positionPanel() {
    var panel = document.getElementById(CONFIG.panelId);
    if (!panel || !state.active) return;
    var box = getOverlayBox();
    panel.style.display = 'block';
    panel.style.position = 'fixed';
    panel.style.zIndex = '9990';
    panel.style.top = Math.round(box.top) + 'px';
    panel.style.left = Math.round(box.left) + 'px';
    panel.style.width = Math.round(box.width) + 'px';
    panel.style.height = Math.round(box.height) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.borderRadius = '8px';
    panel.style.overflow = 'hidden';
    panel.style.background = '#fff';
  }

  function schedulePosition() {
    if (positionTimer) cancelAnimationFrame(positionTimer);
    positionTimer = requestAnimationFrame(function () {
      positionFloatingTab();
      if (state.active) positionPanel();
    });
  }

  function postContextToIframe() {
    var panel = document.getElementById(CONFIG.panelId);
    var iframe = panel && panel.querySelector('iframe');
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({
      type: 'AO_CONTEXT',
      companyId: state.companyId,
      userId: state.userId,
      agent: {
        id: state.agentId,
        name: state.agentName,
        locationId: state.locationId
      }
    }, appOrigin() || '*');
  }

  function renderPanelBody() {
    var panel = document.getElementById(CONFIG.panelId);
    if (!panel) return;
    if (!CONFIG.appUrl || CONFIG.appUrl.indexOf('YOUR_PUBLIC_APP_URL') !== -1) {
      panel.innerHTML = '<div class="ao-missing"><strong>Agent Optimizer is not configured.</strong>' +
        '<p>Edit <code>CONFIG.appUrl</code> in the Custom JS, then reload.</p></div>';
      return;
    }
    var src = buildIframeSrc();
    var existing = panel.querySelector('iframe');
    if (existing && existing.getAttribute('data-ao-src') === src) {
      postContextToIframe();
      return;
    }
    var iframe = document.createElement('iframe');
    iframe.title = 'Agent Optimizer';
    iframe.allow = 'clipboard-read; clipboard-write';
    iframe.setAttribute('data-ao-src', src);
    iframe.src = src;
    iframe.addEventListener('load', postContextToIframe);
    panel.innerHTML = '';
    panel.appendChild(iframe);
  }

  function ensurePanel() {
    var panel = document.getElementById(CONFIG.panelId);
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = CONFIG.panelId;
    panel.setAttribute(ACTIVE_ATTR, 'false');
    document.body.appendChild(panel);
    return panel;
  }

  function setActive(next) {
    state.active = !!next;
    var tab = document.getElementById(CONFIG.tabId);
    var panel = ensurePanel();
    if (tab) {
      tab.setAttribute(ACTIVE_ATTR, state.active ? 'true' : 'false');
      styleOptimizeTab(tab, state.active);
    }
    panel.setAttribute(ACTIVE_ATTR, state.active ? 'true' : 'false');
    if (state.active) {
      state.locationId = state.locationId || extractLocationIdFromUrl();
      state.agentId = state.agentId || extractAgentIdFromUrl();
      renderPanelBody();
      positionPanel();
      setBuilderTab('optimize');
      window.setTimeout(positionPanel, 50);
      window.setTimeout(positionPanel, 300);
    } else {
      restoreBuildLayout();
      panel.style.display = 'none';
      if (getBuilderTab() === 'optimize') setBuilderTab('build');
    }
  }

  function refreshContext() {
    return collectUnsignedContext().then(function (unsigned) {
      return resolveSsoKey().then(function (ssoKey) {
        state.ssoKey = ssoKey;
        state.agentName = unsigned.agentName;
        state.resolveReason = '';
        state.iframeUrl = '';
        return resolveContextWithBackend(unsigned, ssoKey).then(function (resolved) {
          state.companyId = resolved.companyId || unsigned.companyId || '';
          state.locationId = resolved.locationId || unsigned.locationId || '';
          state.locationName = resolved.locationName || unsigned.locationName || '';
          state.userId = resolved.userId || unsigned.userId || '';
          state.agentId = (resolved.agent && resolved.agent.id) || resolved.agentId || unsigned.agentId || '';
          state.agentName = (resolved.agent && resolved.agent.name) || unsigned.agentName || '';
          state.iframeUrl = resolved.iframeUrl || '';
          state.resolveReason = resolved.reason || '';
          log('resolved context', {
            show: resolved.show,
            reason: resolved.reason,
            companyId: state.companyId,
            locationId: state.locationId,
            agentId: state.agentId
          });
          return !!resolved.show;
        });
      });
    }).catch(function (err) {
      warn('embed resolve failed', err);
      state.resolveReason = 'resolve_failed';
      return false;
    });
  }

  function ensureResolvedForPage() {
    var key = pageHref();
    if (key === state.lastResolveKey) return Promise.resolve(state.lastResolveAllowed);
    if (state.resolveInFlight) return Promise.resolve(state.lastResolveAllowed);
    state.resolveInFlight = true;
    return refreshContext().then(function (allowed) {
      state.lastResolveAllowed = allowed;
      state.lastResolveKey = key;
      return allowed;
    }).then(function (allowed) {
      state.resolveInFlight = false;
      return allowed;
    }, function (err) {
      state.resolveInFlight = false;
      throw err;
    });
  }

  function onTabClick(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    state.locationId = extractLocationIdFromUrl();
    state.agentId = extractAgentIdFromUrl();
    state.agentName = extractAgentName();
    setActive(!state.active);
    refreshContext();
  }

  function ensureFloatingTab() {
    ensureStyles();
    ensurePanel();
    var tab = document.getElementById(CONFIG.tabId);
    if (tab) return tab;
    tab = document.createElement('button');
    tab.id = CONFIG.tabId;
    tab.type = 'button';
    tab.setAttribute('data-testid', 'tab-optimize');
    tab.setAttribute(ACTIVE_ATTR, 'false');
    tab.setAttribute('data-ao-ready', 'false');
    tab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg><span>Optimize</span>';
    tab.addEventListener('click', onTabClick, true);
    document.body.appendChild(tab);
    return tab;
  }

  function showTab() {
    var tab = ensureFloatingTab();
    tab.setAttribute('data-ao-ready', 'true');
    positionFloatingTab();
  }

  function hideTab() {
    state.active = false;
    var tab = document.getElementById(CONFIG.tabId);
    var panel = document.getElementById(CONFIG.panelId);
    if (tab) {
      tab.setAttribute('data-ao-ready', 'false');
      tab.setAttribute(ACTIVE_ATTR, 'false');
      styleOptimizeTab(tab, false);
    }
    if (panel) panel.setAttribute(ACTIVE_ATTR, 'false');
    restoreBuildLayout();
  }

  function teardown() {
    hideTab();
    var tab = document.getElementById(CONFIG.tabId);
    var panel = document.getElementById(CONFIG.panelId);
    if (tab) tab.remove();
    if (panel) panel.remove();
  }

  function syncAfterSettle() {
    if (!isVoiceAiSurfaceFromUrl()) {
      hideTab();
      return;
    }
    if (!editorIsReady()) {
      log('Voice AI editor not settled yet');
      hideTab();
      return;
    }

    showTab();
    if (getBuilderTab() === 'optimize' && !state.active) {
      state.locationId = extractLocationIdFromUrl();
      state.agentId = extractAgentIdFromUrl();
      setActive(true);
    }
  }

  function scheduleSettle() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      settleTimer = null;
      try {
        syncAfterSettle();
      } catch (err) {
        warn('settle handler failed', err);
      }
    }, SETTLE_MS);
  }

  function onRouteMaybeChanged() {
    var path = window.location.pathname;
    if (state.lastHref !== path) {
      state.lastHref = path;
      state.lastResolveKey = '';
      state.lastResolveAllowed = false;
      if (state.active) setActive(false);
      hideTab();
    }
    if (!isVoiceAiSurfaceFromUrl()) {
      hideTab();
      return;
    }
    scheduleSettle();
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var control = target.closest('button, [role="tab"], [role="button"], a');
    if (!control || control.id === CONFIG.tabId) return;
    var label = textOf(control).toLowerCase();
    if (label === 'build' || label === 'deploy') {
      if (state.active) setActive(false);
    }
  }, true);

  window.addEventListener('routeLoaded', onRouteMaybeChanged);
  window.addEventListener('routeChangeEvent', onRouteMaybeChanged);
  window.addEventListener('popstate', onRouteMaybeChanged);
  window.addEventListener('hashchange', onRouteMaybeChanged);
  window.addEventListener('resize', schedulePosition);

  var observer = new MutationObserver(function () {
    if (!isVoiceAiSurfaceFromUrl()) return;
    scheduleSettle();
    if (state.active || document.getElementById(CONFIG.tabId)) schedulePosition();
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  // Do not call AppUtils on script load. Wait for a settled Voice AI editor.
  onRouteMaybeChanged();
})();
