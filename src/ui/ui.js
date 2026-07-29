(()=>{
  const $ = id => document.getElementById(id);
  const mode = $('mode');
  const contractsMode = $('contractsMode');
  const transactionsMode = $('transactionsMode');
  const manualPanel = $('manualModePanel');
  const autoPanel = $('autoModePanel');
  const authView = $('authView');
  const appShell = $('appShell');
  const caseCreationView = $('caseCreationView');
  const contractsView = $('contractsView');
  const transactionsView = $('transactionsView');
  const facilityId = $('facilityId');
  const apiUrl = $('apiUrl');
  const username = $('username');
  const password = $('password');
  const loginBtn = $('loginBtn');
  const loginCard = $('loginCard');
  const loginCardBody = $('loginCardBody');
  const loginCollapseBtn = $('loginCollapseBtn');
  const loginCollapseIcon = $('loginCollapseIcon');
  const loginCollapseLabel = $('loginCollapseLabel');
  const suffix = $('suffix');
  const count = $('count');
  const concurrency = $('concurrency');
  const autoCount = $('autoCount');
  const autoConcurrency = $('autoConcurrency');
  const roomSelect = $('roomSelect');
  const apptTypeSelect = $('apptTypeSelect');
  const physicianSelect = $('physicianSelect');
  const cptSelect = $('cptSelect');
  const periodBatchSelect = document.getElementById('periodBatchSelect');
  const periodBatchCreate = document.getElementById('periodBatchCreate');
  const periodSelectWrap = document.getElementById('periodSelectWrap');
  const batchSelectWrap = document.getElementById('batchSelectWrap');
  const periodSelect = document.getElementById('periodSelect');
  const batchSelect = document.getElementById('batchSelect');
  const periodBatchHint = document.getElementById('periodBatchHint');
  const insuranceTypeCreate = document.getElementById('insuranceTypeCreate');
  const insuranceTypeNone = document.getElementById('insuranceTypeNone');
  const insuranceSelectWrap = document.getElementById('insuranceSelectWrap');
  const insuranceSelect = document.getElementById('insuranceSelect');
  const insuranceTypeHint = document.getElementById('insuranceTypeHint');
  const insuranceCreatePriorityWrap = document.getElementById('insuranceCreatePriorityWrap');
  const insurancePriority = document.getElementById('insurancePriority');
  const dosInput = $('dos');
  const runBtn = $('runBtn');
  const seedCard = $('seedCard');
  const supportCard = $('supportCard');
  const logoEl = document.querySelector('.logo');
  const pwdToggle = document.getElementById('pwdToggle');
  const flowDepth = $('flowDepth');
  const flowDepthLabel = $('flowDepthLabel');
  const flowSteps = $('flowSteps');
  const autoActionSelect = $('autoActionSelect');
  const autoRunBtn = $('autoRunBtn');
  const contractsAutoCount = $('contractsAutoCount');
  const contractsManualCount = $('contractsManualCount');
  const contractsSendBtn = $('contractsSendBtn');
  const contractsStatus = $('contractsStatus');
  const contractsAutoPanel = $('contractsAutoPanel');
  const contractsManualPanel = $('contractsManualPanel');
  const contractEffectiveDate = $('contractEffectiveDate');
  const contractExpiryDate = $('contractExpiryDate');
  const contractType = $('contractType');
  const contractNotes = $('contractNotes');
  const contractPctBilledChargesWrap = $('contractPctBilledChargesWrap');
  const contractPctBilledCharges = $('contractPctBilledCharges');
  const logEl = document.getElementById('logCard');
  const logTableBody = document.getElementById('logTableBody');
  const logFilter = document.getElementById('logFilter');
  const logClearBtn = document.getElementById('logClearBtn');
  const logAutoScroll = document.getElementById('logAutoScroll');
  const logBuffer = [];
  const LOG_BUFFER_LIMIT = 400;
  let isAuthenticated = false;
  function isErrorStatus(status){
    if (status === null || typeof status === 'undefined') return false;
    const str = String(status).toLowerCase();
    if (str === 'error' || str === 'fail') return true;
    if (/^\d+$/.test(str)) return Number(str) >= 400;
    if (str.startsWith('4') || str.startsWith('5')) return true;
    return false;
  }
  function pushLogEntry(entry){
    if (!entry) return false;
    const hasError = entry.error && String(entry.error).trim() !== '';
    if (!hasError && !isErrorStatus(entry.status)) return false;
    logBuffer.unshift(entry);
    if (logBuffer.length > LOG_BUFFER_LIMIT) logBuffer.length = LOG_BUFFER_LIMIT;
    return true;
  }
  const elapsedEl = document.getElementById('elapsedDisplay');
  const runProgressFill = document.getElementById('runProgressFill');
  const runProgressLabel = document.getElementById('runProgressLabel');
  const runProgressWrap = document.getElementById('runProgressWrap');
  const HIDDEN_CLASS = 'is-hidden';

  function setVisibility(el, visible, displayMode = 'block') {
    if (!el) return;
    const displayClass = displayMode === 'flex' ? 'is-flex' : 'is-block';
    el.classList.toggle(HIDDEN_CLASS, !visible);
    if (visible) {
      el.classList.add(displayClass);
      el.classList.remove(displayMode === 'flex' ? 'is-block' : 'is-flex');
    } else {
      el.classList.remove('is-block', 'is-flex');
    }
  }

  // Bind default Date of Service to today's date (YYYY-MM-DD) if not already set
  if (dosInput && !dosInput.value) {
    try {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      dosInput.value = `${yyyy}-${mm}-${dd}`;
    } catch (e) { /* ignore */ }
  }

  function syncModePanels(){
    const current = mode ? mode.value : 'manual';
    setVisibility(manualPanel, current === 'manual', 'block');
    setVisibility(autoPanel, current === 'auto', 'block');
  }

  function setActiveView(viewName){
    if (!isAuthenticated) return;
    const nextView = viewName === 'contracts' ? 'contracts' : (viewName === 'transactions' ? 'transactions' : 'caseCreation');
    setVisibility(caseCreationView, nextView === 'caseCreation', 'block');
    setVisibility(contractsView, nextView === 'contracts', 'block');
    setVisibility(transactionsView, nextView === 'transactions', 'block');
    document.querySelectorAll('.side-nav-btn').forEach(btn => {
      const isActive = btn.getAttribute('data-view') === nextView;
      btn.classList.toggle('active', isActive);
    });
    syncModePanels();
  }

  document.querySelectorAll('.side-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveView(btn.getAttribute('data-view')));
  });
  syncModePanels();
  if (mode) mode.addEventListener('change', syncModePanels);
  function syncContractsModePanels(){
    const current = contractsMode ? contractsMode.value : 'auto';
    setVisibility(contractsAutoPanel, current === 'auto', 'block');
    setVisibility(contractsManualPanel, current === 'manual', 'block');
  }
  syncContractsModePanels();
  if (contractsMode) contractsMode.addEventListener('change', syncContractsModePanels);
  function syncContractTypeFields(){
    const isPctBilledCharges = contractType && contractType.value === '% of Billed Charges';
    setVisibility(contractPctBilledChargesWrap, isPctBilledCharges, 'block');
  }
  syncContractTypeFields();
  if (contractType) contractType.addEventListener('change', syncContractTypeFields);
  if (transactionsMode) transactionsMode.addEventListener('change', () => {});
  try { if (count) count.readOnly = false; } catch (e) {}

  function initFlowDepthControls(inputEl, labelEl, stepsEl){
    if (!inputEl || !labelEl) return;
    const update = () => {
      const v = Number(inputEl.value);
      let txt = '';
      if (v===0) txt = 'Create only (patient + case summary)';
      else if (v===1) txt = 'Through Discharge';
      else if (v===2) txt = 'Through Cases-to-Code (no charge entry)';
      else txt = 'Full: Charge Entry';
      labelEl.textContent = txt;
      try { labelEl.dataset.depth = String(v); } catch (e) {}
      try { inputEl.dataset.depth = String(v); } catch (e) {}
      try {
        const pct = Math.min(100, Math.max(0, (v/3)*100));
        inputEl.style.background = `linear-gradient(90deg, var(--trackFill) 0%, var(--trackFill) ${pct}%, var(--trackBg) ${pct}%)`;
      } catch (e) {}
      if (stepsEl){
        const children = stepsEl.querySelectorAll('.flow-step');
        children.forEach(el => {
          const step = Number(el.getAttribute('data-step'));
          el.classList.remove('active','completed','final');
          if (step === v) el.classList.add('active');
          if (step < v) el.classList.add('completed');
          if (v === 3 && step === 3) el.classList.add('final');
        });
      }
    };
    inputEl.addEventListener('input', update);
    if (stepsEl){
      stepsEl.addEventListener('click', (e) => {
        const target = e.target.closest('.flow-step');
        if (!target) return;
        const step = Number(target.getAttribute('data-step'));
        inputEl.value = String(step);
        update();
      });
    }
    update();
  }
  initFlowDepthControls(flowDepth, flowDepthLabel, flowSteps);
  // Auto mode uses an action select instead of a flow depth slider

  function createProgressController(parts = {}){
    const { wrap, fill, label } = parts;
    let timer = null;
    let pct = 0;
    let finalized = false;
    const clamp = (val) => Math.max(0, Math.min(100, Number(val) || 0));
    return {
      show(){ setVisibility(wrap, true, 'flex'); },
      hide(){ setVisibility(wrap, false, 'flex'); },
      reset(text){
        this.stop();
        finalized = false;
        this.setPercent(0, text || 'Idle');
      },
      setPercent(value, text){
        pct = clamp(value);
        if (fill) fill.style.width = pct + '%';
        if (!finalized && label) label.textContent = text || (pct === 0 ? 'Idle' : `${pct}%`);
      },
      animate(){
        this.stop();
        let v = 0;
        timer = setInterval(() => {
          v = (v + 7) % 100;
          this.setPercent(v, 'Running...');
        }, 250);
      },
      stop(){
        if (timer) clearInterval(timer);
        timer = null;
      },
      setStatus(result, pctOverride){
        if (!label) return;
        const effective = clamp(typeof pctOverride === 'number' ? pctOverride : pct);
        if (result === 'pass') {
          finalized = true;
          label.textContent = `${effective}% · Successful`;
        } else if (result === 'fail') {
          finalized = true;
          label.textContent = `${effective}% · Failed`;
        } else {
          finalized = false;
          label.textContent = `${effective}%`;
        }
      },
      getPercent(){ return pct; }
    };
  }

  const progressControllers = {
    manual: createProgressController({ wrap: runProgressWrap, fill: runProgressFill, label: runProgressLabel }),
    auto: createProgressController({ wrap: runProgressWrap, fill: runProgressFill, label: runProgressLabel })
  };

  let token = null;
  // cached option data for search filtering
  let _cachedRooms = null;
  let _cachedAppts = null;
  let _cachedPhysicians = null;
  let _cachedCPTs = null;
  let _cachedPeriods = null;
  let _cachedBatches = null;
  let _cachedInsurances = null;
  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function renderTable(){
    if (!logTableBody) return;
    const q = (logFilter && logFilter.value ? logFilter.value.toLowerCase() : '').trim();
    logTableBody.innerHTML = '';
    const rows = (q ? logBuffer.filter(r => (r.url.toLowerCase().includes(q) || r.method.toLowerCase().includes(q) || String(r.status).toLowerCase().includes(q))) : logBuffer);
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(230,238,248,0.06)';
      const statusColor = (r.status === 'error' || (typeof r.status === 'number' && r.status >= 400)) ? '#fca5a5' : '#86efac';
      tr.innerHTML = `
        <td style=\"padding:6px 8px;color:#cbd5e1;white-space:nowrap\">${r.time}</td>
        <td style=\"padding:6px 8px;color:#a5b4fc;white-space:nowrap\">${r.method}</td>
        <td style=\"padding:6px 8px;color:#e6eef8;max-width:560px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\" title=\"${r.url}\">${r.url}</td>
        <td style=\"padding:6px 8px;color:${statusColor};white-space:nowrap\" title=\"${escapeHtml(r.error || '')}\">${r.status}</td>
        <td style=\"padding:6px 8px;text-align:right;color:#cbd5e1;white-space:nowrap\">${r.duration}</td>
      `;
      logTableBody.appendChild(tr);
    });
    if (logAutoScroll && logAutoScroll.checked && logEl) logEl.scrollTop = 0;
  }

  function formatTime(ts) {
    try {
      const d = ts ? new Date(ts) : new Date();
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } catch (e) { return new Date().toISOString().slice(11,19); }
  }


  function makeOptionsFromRows(rows, makeLabel, makeValue) {
    if (!Array.isArray(rows)) return '';
    return rows.map(r => {
      try {
        const val = makeValue(r);
        const label = makeLabel(r);
        return `<option value="${val}">${label}</option>`;
      } catch (e) { return '' }
    }).join('');
  }

  function filterSelectBySearch(searchEl, selectEl, cachedRows, makeLabel, makeValue) {
    if (!selectEl) return;
    const q = (searchEl && searchEl.value) ? String(searchEl.value).toLowerCase().trim() : '';
    if (!q) {
      // restore original
      selectEl.innerHTML = makeOptionsFromRows(cachedRows || Array.from(selectEl._originalOptions || []), makeLabel, makeValue);
      if (selectEl.options && selectEl.options.length) selectEl.selectedIndex = 0;
      return;
    }
    const source = Array.isArray(cachedRows) ? cachedRows : (Array.isArray(selectEl._originalOptions) ? selectEl._originalOptions : []);
    const filtered = (source || []).filter(r => {
      try {
        const label = String(makeLabel(r) || '').toLowerCase();
        const val = String(makeValue(r) || '').toLowerCase();
        return label.includes(q) || val.includes(q);
      } catch (e) { return false }
    });
    selectEl.innerHTML = makeOptionsFromRows(filtered, makeLabel, makeValue);
    if (selectEl.options && selectEl.options.length) selectEl.selectedIndex = 0;
  }

  // Polling helper: when server returns a runId, poll /seed/status?runId=... for incremental logs
  async function pollRunStatus(runId, opts = {}) {
    const intervalMs = opts.intervalMs || 1000;
    const maxPolls = opts.maxPolls || 300; // 5 minutes default
    let polls = 0;
    let finished = false;
    let lastCount = 0;
    const progressCtrl = opts.progressCtrl;
    const totalCount = Number(opts.totalCount) || 1;
    while (!finished && polls < maxPolls) {
      polls += 1;
      try {
        const q = '/seed/status?runId=' + encodeURIComponent(runId);
        const res = await fetch(q, { method: 'GET', headers: { 'token': token || '' } });
        let j2 = null;
        try { j2 = await res.json(); } catch (e) { j2 = null; }
        if (!j2) {
          await new Promise(r => setTimeout(r, intervalMs));
          continue;
        }
        // merge any new logs
        try {
          if (Array.isArray(j2.logs) && j2.logs.length) {
            // assume server returns logs in chronological order; add newest to front
            const newLogs = j2.logs.slice(lastCount);
            if (newLogs.length) {
              // insert each new log at front so recent entries show on top (consistent with existing UI)
              for (let i = newLogs.length - 1; i >= 0; i--) {
                const l = newLogs[i];
                const when = formatTime(l.startTime || l.timestamp);
                const status = l.status || (l.error ? 'error' : 'unknown');
                const dur = Number(l.durationMs || 0);
                const dsec = (dur/1000).toFixed(2) + 's';
                pushLogEntry({ time: when, method: l.method || 'GET', url: l.url || '', status, duration: dsec, error: l.error });
              }
              renderTable();
            }
            lastCount = j2.logs.length;
          }
        } catch (e) { /* ignore merge errors */ }

        // update percent if provided
        try {
          if (progressCtrl && typeof j2.completedCount === 'number') {
            const done = Number(j2.completedCount || 0);
            const pct = Math.round(Math.min(100, (done / Math.max(1, totalCount)) * 100));
            progressCtrl.setPercent(pct, `${pct}%`);
          } else if (progressCtrl && typeof j2.percent === 'number') {
            progressCtrl.setPercent(j2.percent, `${Math.round(j2.percent)}%`);
          }
        } catch (e) {}

        // check finished
        if (j2.finished || j2.ok || j2.status === 'finished' || j2.completed) {
          finished = true;
          // return final combined object (prefer j2 but include runId)
          return Object.assign({}, j2, { runId });
        }
      } catch (e) {
        // ignore transient network errors and retry
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    // timed out; return empty object with runId
    return { runId, ok: false, finished: false };
  }

  async function executeSeedRun({ payload, progressCtrl, totalCount }) {
    const ctrl = progressCtrl || progressControllers.manual;
    const targetTotal = Number(totalCount) || Number(payload?.opts?.count) || 1;
    try { if (logoEl) logoEl.classList.add('running'); } catch (e) {}
    try { if (elapsedEl) elapsedEl.textContent = 'Total: 0.00s'; } catch (e) {}
    if (ctrl) {
      ctrl.show();
      ctrl.reset('Starting...');
    }
    log('Sending seed request: ' + JSON.stringify(payload));
    if (ctrl) ctrl.animate();
    let j = null;
    try {
      const res = await fetch('/seed', { method: 'POST', headers: {'Content-Type':'application/json','token': token || ''}, body: JSON.stringify(payload) });
      try { j = await res.json(); } catch (e) { j = { ok: false, error: 'invalid-json' }; }
    } catch (e) {
      j = { ok: false, error: String(e) };
    }
    if (ctrl) ctrl.stop();
    try { if (logoEl) logoEl.classList.remove('running'); } catch (e) {}
    log('Seed response: ' + JSON.stringify(j));
    let finalResp = j;
    try {
      if (j && j.runId) {
        const polled = await pollRunStatus(j.runId, { intervalMs: 800, maxPolls: 900, progressCtrl: ctrl, totalCount: targetTotal });
        if (polled && typeof polled === 'object') {
          finalResp = Object.assign({}, j, polled);
        }
      }
            if (sup.periods && Array.isArray(sup.periods) && periodSelect) {
              try {
                periodSelect.innerHTML = sup.periods.map(p => `<option value="${p.id ?? p.periodId ?? p.value}">${p.name ?? p.label ?? JSON.stringify(p)}</option>`).join('');
                if (periodSelect.options && periodSelect.options.length) periodSelect.selectedIndex = 0;
              } catch (e) { /* ignore */ }
            }
            if (sup.batches && Array.isArray(sup.batches) && batchSelect) {
              try {
                batchSelect.innerHTML = sup.batches.map(b => `<option value="${b.id ?? b.batchId ?? b.value}">${b.name ?? b.label ?? JSON.stringify(b)}</option>`).join('');
                if (batchSelect.options && batchSelect.options.length) batchSelect.selectedIndex = 0;
              } catch (e) { /* ignore */ }
            }
    } catch (e) {
      // ignore polling errors and fall back to original response
    }

    try {
      if (elapsedEl && finalResp) {
        if (typeof finalResp.runElapsedMs === 'number') {
          const s = (finalResp.runElapsedMs/1000).toFixed(2);
          elapsedEl.textContent = `Total: ${s}s`;
        } else if (Array.isArray(finalResp.logs) && finalResp.logs.length) {
          let sumMs = 0;
          let minStart = Number.MAX_SAFE_INTEGER;
          let maxEnd = 0;
          finalResp.logs.forEach(it => {
            const d = Number(it.durationMs) || 0;
            sumMs += d;
            const ts = it.timestamp ? Date.parse(it.timestamp) : NaN;
            if (!Number.isNaN(ts)) {
              minStart = Math.min(minStart, ts);
              maxEnd = Math.max(maxEnd, ts + d);
            }
          });
          const wallMs = (minStart === Number.MAX_SAFE_INTEGER) ? sumMs : Math.max(0, maxEnd - minStart);
          const wallS = (wallMs / 1000).toFixed(2);
          const sumS = (sumMs / 1000).toFixed(2);
          elapsedEl.textContent = `Wall: ${wallS}s · Sum: ${sumS}s`;
        }
      }
    } catch (e) { log('elapsed calc error'); }

    try {
      if (finalResp && Array.isArray(finalResp.logs)) {
        log('--- API Call Logs ---');
        finalResp.logs.forEach(l => {
          try {
            const when = formatTime(l.startTime || l.timestamp);
            const status = l.status || (l.error ? 'error' : 'unknown');
            const dur = Number(l.durationMs || 0);
            const dsec = (dur/1000).toFixed(2)+'s';
            pushLogEntry({ time: when, method: l.method, url: l.url, status, duration: dsec, error: l.error });
          } catch (e) { /* ignore per-log parse error */ }
        });
        let failureCount = 0;
        try {
          const total = targetTotal || (finalResp.logs.length || 1);
          failureCount = (finalResp.logs || []).reduce((acc, it) => {
            try {
              const st = it.status || (it.error ? 'error' : undefined);
              if (st === undefined || st === null) return acc;
              if (typeof st === 'number') return acc + (st >= 400 ? 1 : 0);
              const s = String(st).toLowerCase().trim();
              if (s === 'error') return acc + 1;
              if (/^\d+$/.test(s)) return acc + (Number(s) >= 400 ? 1 : 0);
              if (s.startsWith('4') || s.startsWith('5')) return acc + 1;
              return acc;
            } catch (e) { return acc; }
          }, 0);
          const done = (finalResp._completedCount != null) ? Number(finalResp._completedCount) : (finalResp.logs.length || 0);
          const pct = Math.round(Math.min(100, (done / Math.max(1,total)) * 100));
          if (ctrl) ctrl.setPercent(pct, `${pct}%`);
        } catch (e) { /* ignore progress calc error */ }
        renderTable();
        if (ctrl) {
          if (failureCount > 0) {
            ctrl.setPercent(100, 'Completed');
            ctrl.setStatus('fail', ctrl.getPercent());
          } else if (finalResp && finalResp.ok) {
            ctrl.setPercent(100, 'Completed');
            ctrl.setStatus('pass', 100);
          } else {
            ctrl.setPercent(100, 'Completed');
            ctrl.setStatus('fail', 100);
          }
        }
      } else if (ctrl) {
        if (finalResp && finalResp.ok) {
          ctrl.setPercent(100, 'Completed');
          ctrl.setStatus('pass', 100);
        } else {
          ctrl.setPercent(100, 'Completed');
          ctrl.setStatus('fail', 100);
        }
      }
    } catch (e) {
      if (ctrl) ctrl.setStatus('fail', ctrl.getPercent());
    }
  }

  // Create a custom dropdown that embeds a search input as the first element inside the dropdown panel.
  // This replaces the native select UI visually but keeps the native select element (hidden) for form values.
  function createCustomDropdown(selectEl, cachedRowsGetter, makeLabel, makeValue) {
    if (!selectEl) return;
    // hide native select visually
    selectEl.style.display = 'none';
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    wrapper.style.display = 'inline-block';
    wrapper.style.position = 'relative';
    wrapper.style.minWidth = (selectEl.offsetWidth || 180) + 'px';

    const display = document.createElement('div');
    display.className = 'cs-selected';
    display.tabIndex = 0;
    display.style.padding = '8px 10px';
    display.style.border = '1px solid rgba(15,23,42,0.06)';
    display.style.borderRadius = '8px';
    display.style.background = 'var(--input)';
    display.style.cursor = 'pointer';
    display.style.minWidth = '160px';
    display.style.boxSizing = 'border-box';
    display.textContent = (selectEl.selectedOptions && selectEl.selectedOptions[0]) ? selectEl.selectedOptions[0].textContent : 'Select...';

    const panel = document.createElement('div');
    panel.className = 'cs-panel';
    panel.style.position = 'absolute';
    panel.style.left = '0';
    panel.style.top = 'calc(100% + 6px)';
    panel.style.zIndex = 999;
    panel.style.background = 'white';
    panel.style.border = '1px solid rgba(15,23,42,0.06)';
    panel.style.borderRadius = '8px';
    panel.style.boxShadow = '0 6px 18px rgba(15,23,42,0.06)';
    panel.style.padding = '8px';
    panel.style.display = 'none';
    panel.style.width = Math.max(200, selectEl.offsetWidth || 220) + 'px';

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Type to filter...';
    search.style.width = '100%';
    search.style.padding = '6px 8px';
    search.style.marginBottom = '6px';
    search.style.boxSizing = 'border-box';

    const list = document.createElement('div');
    list.style.maxHeight = '220px';
    list.style.overflow = 'auto';
    list.style.width = '100%';

    panel.appendChild(search);
    panel.appendChild(list);
    wrapper.appendChild(display);
    wrapper.appendChild(panel);
    selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);

    function buildList(rows) {
      list.innerHTML = '';
      if (!Array.isArray(rows) || rows.length === 0) {
        const empty = document.createElement('div');
        empty.style.padding = '8px';
        empty.style.color = 'var(--muted)';
        empty.textContent = 'No options';
        list.appendChild(empty);
        return;
      }
      rows.forEach(r => {
        const item = document.createElement('div');
        item.style.padding = '6px 8px';
        item.style.cursor = 'pointer';
        item.style.borderRadius = '6px';
        item.style.whiteSpace = 'nowrap';
        item.style.overflow = 'hidden';
        item.style.textOverflow = 'ellipsis';
        const label = String(makeLabel(r) || '');
        const val = String(makeValue(r) || '');
        item.textContent = label;
        item.dataset.value = val;
        item.dataset.label = label;
        item.addEventListener('click', () => {
          try {
            // ensure native select has this option so selectedOptions/textContent work later
            let opt = Array.from(selectEl.options || []).find(o => String(o.value) === String(val));
            if (!opt) {
              opt = new Option(label, val);
              try { selectEl.add(opt); } catch (e) { /* ignore */ }
            }
            try { selectEl.value = val; } catch (e) {}
          } catch (e) {}
          display.textContent = label;
          const ev = new Event('change', { bubbles: true });
          try { selectEl.dispatchEvent(ev); } catch (e) {}
          panel.style.display = 'none';
        });
        item.addEventListener('mouseover', () => { item.style.background = '#f3f4f6'; });
        item.addEventListener('mouseout', () => { item.style.background = 'transparent'; });
        list.appendChild(item);
      });
    }

    function refresh() {
      const rows = (cachedRowsGetter && typeof cachedRowsGetter === 'function') ? cachedRowsGetter() : [];
      buildList(Array.isArray(rows) ? rows : (selectEl._originalOptions || []));
      // sync visible display with native select if possible
      try {
        const so = (selectEl && selectEl.selectedOptions && selectEl.selectedOptions[0]);
        if (so && so.textContent) display.textContent = so.textContent;
      } catch (e) {}
    }

    display.addEventListener('click', () => { panel.style.display = (panel.style.display === 'none') ? 'block' : 'none'; search.focus(); });
    display.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); panel.style.display = 'block'; search.focus(); } });
    search.addEventListener('input', () => {
      const q = String(search.value || '').toLowerCase().trim();
      const rows = (cachedRowsGetter && typeof cachedRowsGetter === 'function') ? cachedRowsGetter() : (selectEl._originalOptions || []);
      if (!q) return buildList(rows || []);
      const filtered = (rows || []).filter(r => {
        try { const lab = String(makeLabel(r) || '').toLowerCase(); const val = String(makeValue(r) || '').toLowerCase(); return lab.includes(q) || val.includes(q); } catch (e) { return false }
      });
      buildList(filtered);
    });

    document.addEventListener('click', (e) => { if (!wrapper.contains(e.target)) panel.style.display = 'none'; });

    selectEl._custom = { wrapper, display, panel, refresh };
    refresh();
  }

  // create custom dropdowns for each select so the search input appears inside the list panel
  createCustomDropdown(roomSelect, () => _cachedRooms, r => (r.name ?? r.roomName ?? r.RoomName ?? r.displayName ?? JSON.stringify(r)), r => (r.roomId ?? r.RoomId ?? r.roomID ?? r.id ?? ''));
  createCustomDropdown(apptTypeSelect, () => _cachedAppts, a => (a.appointment_Type_Desc ?? a.appTypeDesc ?? a.description ?? a.name ?? JSON.stringify(a)), a => (a.appointmentTypeId ?? a.AppointmentTypeId ?? a.appointmentTypeID ?? a.id ?? ''));
  createCustomDropdown(physicianSelect, () => _cachedPhysicians, p => ((p.fullName ?? p.FullName ?? p.name) || `${p.firstName || ''} ${p.lastName || ''}`.trim() || JSON.stringify(p)), p => (p.personId ?? p.PersonId ?? p.id ?? ''));
  // add searchable dropdowns for period, batch and insurance selects
  createCustomDropdown(periodSelect, () => _cachedPeriods, p => ((p.label ?? p.periodName ?? String(p.periodId)) || JSON.stringify(p)), p => (p.periodId ?? p.value ?? ''));
  createCustomDropdown(batchSelect, () => _cachedBatches, b => ((b.batchDescription ?? b.label ?? String(b.batchId)) || JSON.stringify(b)), b => (b.batchId ?? b.id ?? ''));
  createCustomDropdown(insuranceSelect, () => _cachedInsurances, i => (i.insuranceCarrierName ?? i.insuranceName ?? i.name ?? JSON.stringify(i)), i => (i.insuranceCarrierId ?? i.insuranceId ?? i.id ?? ''));
  // cptSelect is a native multi-select; do not create custom single-select dropdown for it
  function createCustomMultiDropdown(selectEl, cachedRowsGetter, makeLabel, makeValue) {
    if (!selectEl) return;
    selectEl.style.display = 'none';
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    wrapper.style.display = 'inline-block';
    wrapper.style.position = 'relative';
    wrapper.style.minWidth = (selectEl.offsetWidth || 180) + 'px';

    const display = document.createElement('div');
    display.className = 'cs-selected';
    display.tabIndex = 0;
    display.style.padding = '8px 10px';
    display.style.border = '1px solid rgba(15,23,42,0.06)';
    display.style.borderRadius = '8px';
    display.style.background = 'var(--input)';
    display.style.cursor = 'pointer';
    display.style.minWidth = '160px';
    display.style.boxSizing = 'border-box';
    display.textContent = (selectEl.selectedOptions && selectEl.selectedOptions.length ? `${selectEl.selectedOptions.length} selected` : 'Select...');

    const panel = document.createElement('div');
    panel.className = 'cs-panel';
    panel.style.position = 'absolute';
    panel.style.left = '0';
    panel.style.top = 'calc(100% + 6px)';
    panel.style.zIndex = 999;
    panel.style.background = 'white';
    panel.style.border = '1px solid rgba(15,23,42,0.06)';
    panel.style.borderRadius = '8px';
    panel.style.boxShadow = '0 6px 18px rgba(15,23,42,0.06)';
    panel.style.padding = '8px';
    panel.style.display = 'none';
    panel.style.width = Math.max(300, selectEl.offsetWidth || 320) + 'px';

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Type to filter...';
    search.style.width = '100%';
    search.style.padding = '6px 8px';
    search.style.marginBottom = '6px';
    search.style.boxSizing = 'border-box';

    const list = document.createElement('div');
    list.style.maxHeight = '240px';
    list.style.overflow = 'auto';
    list.style.width = '100%';

    panel.appendChild(search);
    panel.appendChild(list);
    wrapper.appendChild(display);
    wrapper.appendChild(panel);
    selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);

    function buildList(rows) {
      list.innerHTML = '';
      if (!Array.isArray(rows) || rows.length === 0) {
        const empty = document.createElement('div');
        empty.style.padding = '8px';
        empty.style.color = 'var(--muted)';
        empty.textContent = 'No options';
        list.appendChild(empty);
        return;
      }
      rows.forEach(r => {
        const id = String(makeValue(r) || '');
        const label = String(makeLabel(r) || '');
        const opt = Array.from(selectEl.options || []).find(o => String(o.value) === id);
        if (!opt) {
          try { selectEl.add(new Option(label, id)); } catch (e) { /* ignore */ }
        }
        const item = document.createElement('div');
        item.style.padding = '6px 8px';
        item.style.cursor = 'pointer';
        item.style.borderRadius = '6px';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '8px';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = id;
        cb.checked = !!(Array.from(selectEl.options || []).find(o => String(o.value) === id && o.selected));

        // amount input for this CPT (visible when checkbox checked)
        const amt = document.createElement('input');
        amt.type = 'number';
        amt.step = '0.01';
        amt.min = '0';
        amt.placeholder = 'Amount';
        amt.style.width = '100px';
        amt.style.padding = '4px 6px';
        amt.style.border = '1px solid rgba(15,23,42,0.06)';
        amt.style.borderRadius = '6px';
        amt.style.boxSizing = 'border-box';
        amt.style.display = cb.checked ? '' : 'none';

        // initialize stored amount on the native option element so refresh can preserve it
        try {
          const nativeOpt = Array.from(selectEl.options || []).find(o => String(o.value) === id);
          if (nativeOpt && typeof nativeOpt._amount === 'undefined') nativeOpt._amount = '';
          if (nativeOpt && nativeOpt._amount) amt.value = nativeOpt._amount;
        } catch (e) {}

        cb.addEventListener('change', (e) => {
          try {
            const o = Array.from(selectEl.options || []).find(o2 => String(o2.value) === id);
            if (o) o.selected = cb.checked;
            // show/hide amount input
            amt.style.display = cb.checked ? '' : 'none';
            // update display text
            const selCount = (selectEl.selectedOptions && selectEl.selectedOptions.length) ? selectEl.selectedOptions.length : 0;
            display.textContent = selCount ? `${selCount} selected` : 'Select...';
            const ev = new Event('change', { bubbles: true });
            try { selectEl.dispatchEvent(ev); } catch (e) {}
          } catch (e) {}
        });

        // save amount to native option whenever changed
        amt.addEventListener('input', () => {
          try {
            const o = Array.from(selectEl.options || []).find(o2 => String(o2.value) === id);
            if (o) o._amount = amt.value;
          } catch (e) {}
        });

        const span = document.createElement('div');
        span.style.flex = '1';
        span.style.whiteSpace = 'nowrap';
        span.style.overflow = 'hidden';
        span.style.textOverflow = 'ellipsis';
        span.textContent = label;
        item.appendChild(cb);
        item.appendChild(span);
        item.appendChild(amt);
        item.addEventListener('click', (ev) => {
          // avoid double toggling when clicking checkbox or amount input
          if (ev.target === cb || ev.target === amt) return;
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        });
        item.addEventListener('mouseover', () => { item.style.background = '#f3f4f6'; });
        item.addEventListener('mouseout', () => { item.style.background = 'transparent'; });
        list.appendChild(item);
      });
    }

    function refresh() {
      const rows = (cachedRowsGetter && typeof cachedRowsGetter === 'function') ? cachedRowsGetter() : [];
      buildList(Array.isArray(rows) ? rows : (selectEl._originalOptions || []));
      try {
        const so = (selectEl && selectEl.selectedOptions && selectEl.selectedOptions[0]);
        display.textContent = (selectEl.selectedOptions && selectEl.selectedOptions.length) ? `${selectEl.selectedOptions.length} selected` : (so && so.textContent ? so.textContent : 'Select...');
      } catch (e) {}
    }

    display.addEventListener('click', () => { panel.style.display = (panel.style.display === 'none') ? 'block' : 'none'; search.focus(); });
    display.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); panel.style.display = 'block'; search.focus(); } });
    search.addEventListener('input', () => {
      const q = String(search.value || '').toLowerCase().trim();
      const rows = (cachedRowsGetter && typeof cachedRowsGetter === 'function') ? cachedRowsGetter() : (selectEl._originalOptions || []);
      if (!q) return buildList(rows || []);
      const filtered = (rows || []).filter(r => {
        try { const lab = String(makeLabel(r) || '').toLowerCase(); const val = String(makeValue(r) || '').toLowerCase(); return lab.includes(q) || val.includes(q); } catch (e) { return false }
      });
      buildList(filtered);
    });

    document.addEventListener('click', (e) => { if (!wrapper.contains(e.target)) panel.style.display = 'none'; });

    selectEl._custom = { wrapper, display, panel, refresh };
    refresh();
  }

  // initialize custom multi-select for CPT
  createCustomMultiDropdown(cptSelect, () => _cachedCPTs, fs => ((fs?.cptProcedure?.cptCode ?? fs?.cptCode ?? fs?.code ?? '') + (fs?.cptProcedure?.cptDescription ? (' — ' + fs.cptProcedure.cptDescription) : '')), fs => (fs?.cptProcedure?.cptProcedureId ?? fs?.cptProcedureId ?? fs?.id ?? ''));

  // helper to toggle visibility of Period/Batch selects
  function updatePeriodBatchVisibility() {
    try {
      const sel = document.querySelector('input[name="periodBatch"]:checked');
      const showSelects = sel && sel.value === 'select';
      setVisibility(periodSelectWrap, showSelects, 'block');
      setVisibility(batchSelectWrap, showSelects, 'block');
    } catch (e) { /* ignore */ }
  }
  // attach listeners to radio buttons
  try { if (periodBatchSelect) periodBatchSelect.addEventListener('change', updatePeriodBatchVisibility); } catch (e) {}
  try { if (periodBatchCreate) periodBatchCreate.addEventListener('change', updatePeriodBatchVisibility); } catch (e) {}
  // initial visibility
  updatePeriodBatchVisibility();

  // helper to toggle visibility of Insurance select
  function updateInsuranceVisibility() {
    try {
      const sel = document.querySelector('input[name="insuranceType"]:checked');
      // show/hide create-priority UI when insuranceType is 'create'
      const isCreate = sel && sel.value === 'create';
      setVisibility(insuranceCreatePriorityWrap, isCreate, 'block');
      // keep insuranceSelectWrap hidden by default (mapping via select not used)
      const showSelect = false;
      setVisibility(insuranceSelectWrap, showSelect, 'block');
    } catch (e) { /* ignore */ }
  }
  try { if (insuranceTypeCreate) insuranceTypeCreate.addEventListener('change', updateInsuranceVisibility); } catch (e) {}
  try { if (insuranceTypeNone) insuranceTypeNone.addEventListener('change', updateInsuranceVisibility); } catch (e) {}
  // initial visibility: hide insurance select since 'Select' option removed
  updateInsuranceVisibility();

  // when period changes, update batch select
  try {
    if (periodSelect) {
      periodSelect.addEventListener('change', () => {
        try {
          const pid = periodSelect.value;
          const items = Array.isArray(_cachedBatches) ? _cachedBatches.filter(b => String(b.periodId) === String(pid)) : [];
          if (batchSelect) {
            batchSelect.innerHTML = items.map(b => `<option value="${b.batchId}">${b.batchDescription ?? b.label ?? String(b.batchId)}</option>`).join('');
            if (batchSelect.options && batchSelect.options.length) batchSelect.selectedIndex = 0;
            try { if (batchSelect && batchSelect._custom && typeof batchSelect._custom.refresh === 'function') batchSelect._custom.refresh(); } catch (e) {}
          }
        } catch (e) {}
      });
    }
  } catch (e) {}

  function log(msg){ /* deprecated: keep for rare notes, but do not add to table to avoid noise */ }

  if (logFilter) logFilter.addEventListener('input', renderTable);
  if (logClearBtn) logClearBtn.addEventListener('click', () => { logBuffer.splice(0, logBuffer.length); renderTable(); });

  loginBtn.addEventListener('click', async () => {
    // Clear previous logs on each login attempt
    logBuffer.splice(0, logBuffer.length);
    renderTable();
    const res = await fetch('/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username: username.value, password: password.value, facilityId: Number(facilityId.value), apiUrl: apiUrl.value }) });
    const j = await res.json();
    if (j && j.ok && j.token) {
      token = j.token;
      isAuthenticated = true;
      // Auto-collapse body, keep header visible
      try {
        if (loginCardBody) {
          loginCardBody.style.display = 'none';
          if (loginCollapseIcon) loginCollapseIcon.style.transform = 'rotate(-90deg)';
          if (loginCollapseLabel) loginCollapseLabel.textContent = 'Expand';
          if (loginCollapseBtn) loginCollapseBtn.setAttribute('aria-expanded','false');
          if (loginCard) loginCard.classList.add('collapsed');
        }
      } catch (e) {}
      // Logged in — keep UI clean, skip noisy logs
      setVisibility(authView, false, 'block');
      setVisibility(appShell, true, 'flex');
      setActiveView('caseCreation');
      setVisibility(seedCard, true, 'block');
      setVisibility(supportCard, true, 'block');
      // populate selects from returned support data if present
      try {
        if (j.rooms && Array.isArray(j.rooms) && roomSelect) {
          _cachedRooms = j.rooms.slice();
          roomSelect._originalOptions = j.rooms.slice();
          roomSelect.innerHTML = j.rooms.map(r => {
            const value = r.roomId ?? r.RoomId ?? r.roomID ?? r.id ?? '';
            const label = r.name ?? r.roomName ?? r.RoomName ?? r.displayName ?? JSON.stringify(r);
            return `<option value="${value}">${label}</option>`;
          }).join('');
          // select first available
          if (roomSelect.options && roomSelect.options.length) roomSelect.selectedIndex = 0;
            try { if (roomSelect && roomSelect._custom && typeof roomSelect._custom.refresh === 'function') roomSelect._custom.refresh(); } catch (e) {}
        }
        if (j.appointmentTypes && Array.isArray(j.appointmentTypes) && apptTypeSelect) {
          _cachedAppts = j.appointmentTypes.slice();
          apptTypeSelect._originalOptions = j.appointmentTypes.slice();
          apptTypeSelect.innerHTML = j.appointmentTypes.map(a => {
            const value = a.appointmentTypeId ?? a.AppointmentTypeId ?? a.appointmentTypeID ?? a.id ?? '';
            const label = a.appointment_Type_Desc ?? a.appTypeDesc ?? a.description ?? a.name ?? JSON.stringify(a);
            return `<option value="${value}">${label}</option>`;
          }).join('');
          if (apptTypeSelect.options && apptTypeSelect.options.length) apptTypeSelect.selectedIndex = 0;
            try { if (apptTypeSelect && apptTypeSelect._custom && typeof apptTypeSelect._custom.refresh === 'function') apptTypeSelect._custom.refresh(); } catch (e) {}
        }
        if (j.physicians && Array.isArray(j.physicians) && physicianSelect) {
          _cachedPhysicians = j.physicians.slice();
          physicianSelect._originalOptions = j.physicians.slice();
          physicianSelect.innerHTML = j.physicians.map(p => {
            const value = p.personId ?? p.PersonId ?? p.id ?? '';
            const computedName = `${p.firstName || ''} ${p.lastName || ''}`.trim();
            const label = (p.fullName ?? p.FullName ?? p.name ?? computedName) || JSON.stringify(p);
            return `<option value="${value}">${label}</option>`;
          }).join('');
          if (physicianSelect.options && physicianSelect.options.length) physicianSelect.selectedIndex = 0;
            try { if (physicianSelect && physicianSelect._custom && typeof physicianSelect._custom.refresh === 'function') physicianSelect._custom.refresh(); } catch (e) {}
        }
      } catch (e) { log('populate selects error'); }
      // Immediately fetch support data after login and populate dropdowns
      try {
        const body = { apiUrl: apiUrl.value, facilityId: Number(facilityId.value) };
        // Fetching support data after login
        const res2 = await fetch('/support-data', { method: 'POST', headers: { 'Content-Type': 'application/json', 'token': token || '' }, body: JSON.stringify(body) });
        const sup = await res2.json();
        if (!sup || !sup.ok) {
          log('Support data error: ' + JSON.stringify(sup));
        } else {
          // omit verbose support first-item logs
          try {
            if (sup.rooms && Array.isArray(sup.rooms) && roomSelect) {
              _cachedRooms = sup.rooms.slice();
              roomSelect._originalOptions = sup.rooms.slice();
              roomSelect.innerHTML = sup.rooms.map(r => {
                const value = r.roomId ?? r.RoomId ?? r.roomID ?? r.id ?? '';
                const label = r.name ?? r.roomName ?? r.RoomName ?? r.displayName ?? JSON.stringify(r);
                return `<option value="${value}">${label}</option>`;
              }).join('');
              if (roomSelect.options && roomSelect.options.length) roomSelect.selectedIndex = 0;
              try { if (roomSelect && roomSelect._custom && typeof roomSelect._custom.refresh === 'function') roomSelect._custom.refresh(); } catch (e) {}
            }
            if (sup.appointmentTypes && Array.isArray(sup.appointmentTypes) && apptTypeSelect) {
              _cachedAppts = sup.appointmentTypes.slice();
              apptTypeSelect._originalOptions = sup.appointmentTypes.slice();
              apptTypeSelect.innerHTML = sup.appointmentTypes.map(a => {
                const value = a.appointmentTypeId ?? a.AppointmentTypeId ?? a.appointmentTypeID ?? a.id ?? '';
                const label = a.appointment_Type_Desc ?? a.appTypeDesc ?? a.description ?? a.name ?? JSON.stringify(a);
                return `<option value="${value}">${label}</option>`;
              }).join('');
              if (apptTypeSelect.options && apptTypeSelect.options.length) apptTypeSelect.selectedIndex = 0;
              try { if (apptTypeSelect && apptTypeSelect._custom && typeof apptTypeSelect._custom.refresh === 'function') apptTypeSelect._custom.refresh(); } catch (e) {}
            }
            if (sup.physicians && Array.isArray(sup.physicians) && physicianSelect) {
              _cachedPhysicians = sup.physicians.slice();
              physicianSelect._originalOptions = sup.physicians.slice();
              physicianSelect.innerHTML = sup.physicians.map(p => {
                const value = p.personId ?? p.PersonId ?? p.id ?? '';
                const computedName = `${p.firstName || ''} ${p.lastName || ''}`.trim();
                const label = (p.fullName ?? p.FullName ?? p.name ?? computedName) || JSON.stringify(p);
                return `<option value="${value}">${label}</option>`;
              }).join('');
              if (physicianSelect.options && physicianSelect.options.length) physicianSelect.selectedIndex = 0;
              try { if (physicianSelect && physicianSelect._custom && typeof physicianSelect._custom.refresh === 'function') physicianSelect._custom.refresh(); } catch (e) {}
            }
            // populate periods and batches (from getPeriodBatches)
            try {
              if (Array.isArray(sup.periods) && periodSelect) {
                _cachedPeriods = sup.periods.slice();
                // Only include periods that have batches
                const filtered = _cachedPeriods.filter(p => Array.isArray(p.batches) && p.batches.length > 0);
                periodSelect._originalOptions = filtered.slice();
                periodSelect.innerHTML = filtered.map(p => `<option value="${p.periodId}">${p.label ?? p.periodName ?? String(p.periodId)}</option>`).join('');
                if (periodSelect.options && periodSelect.options.length) periodSelect.selectedIndex = 0;
                try { if (periodSelect && periodSelect._custom && typeof periodSelect._custom.refresh === 'function') periodSelect._custom.refresh(); } catch (e) {}
              }
              if (Array.isArray(sup.batches) && batchSelect) {
                _cachedBatches = sup.batches.slice();
                batchSelect._originalOptions = sup.batches.slice();
                // default to batches for first selected period (if any)
                const firstPeriodId = periodSelect && periodSelect.value ? periodSelect.value : undefined;
                const initialBatches = (firstPeriodId && Array.isArray(_cachedBatches)) ? _cachedBatches.filter(b => String(b.periodId) === String(firstPeriodId)) : _cachedBatches.slice();
                batchSelect.innerHTML = initialBatches.map(b => `<option value="${b.batchId}">${b.batchDescription ?? b.label ?? String(b.batchId)}</option>`).join('');
                if (batchSelect.options && batchSelect.options.length) batchSelect.selectedIndex = 0;
                try { if (batchSelect && batchSelect._custom && typeof batchSelect._custom.refresh === 'function') batchSelect._custom.refresh(); } catch (e) {}
              }
            } catch (e) { /* ignore period/batch populate errors */ }
            if (sup.feeSchedule && Array.isArray(sup.feeSchedule) && cptSelect) {
              _cachedCPTs = sup.feeSchedule.slice();
              cptSelect._originalOptions = sup.feeSchedule.slice();
              cptSelect.innerHTML = sup.feeSchedule.map(fs => {
                const val = fs?.cptProcedure?.cptProcedureId ?? fs?.cptProcedureId ?? fs?.id ?? '';
                const code = fs?.cptProcedure?.cptCode ?? fs?.cptCode ?? fs?.code ?? '';
                const label = code || (fs && JSON.stringify(fs)) || '';
                return `<option value="${val}">${label}</option>`;
              }).join('');
              if (cptSelect.options && cptSelect.options.length) cptSelect.selectedIndex = 0;
                try { if (cptSelect && cptSelect._custom && typeof cptSelect._custom.refresh === 'function') cptSelect._custom.refresh(); } catch (e) {}
            }
            // populate insurances if provided by support data
            try {
              if (Array.isArray(sup.insurances) && insuranceSelect) {
                _cachedInsurances = sup.insurances.slice();
                insuranceSelect._originalOptions = sup.insurances.slice();
                insuranceSelect.innerHTML = sup.insurances.map(ins => {
                  const val = ins.insuranceCarrierId ?? ins.insuranceId ?? ins.id ?? ins.value ?? '';
                  const label = ins.insuranceCarrierName ?? ins.insuranceName ?? ins.name ?? ins.displayName ?? JSON.stringify(ins);
                  return `<option value="${val}">${label}</option>`;
                }).join('');
                if (insuranceSelect.options && insuranceSelect.options.length) insuranceSelect.selectedIndex = 0;
                try { if (insuranceSelect && insuranceSelect._custom && typeof insuranceSelect._custom.refresh === 'function') insuranceSelect._custom.refresh(); } catch (e) {}
              }
            } catch (e) { /* ignore insurance populate errors */ }
          } catch (e) { /* ignore populate support selects error */ }
          try {
            if (sup && Array.isArray(sup.logs)) {
              sup.logs.forEach(l => {
                try {
                  const when = formatTime(l.startTime || l.timestamp);
                  const status = l.status || (l.error ? 'error' : 'unknown');
                  const dur = Number(l.durationMs || 0);
                  const dsec = (dur/1000).toFixed(2) + 's';
                  pushLogEntry({ time: when, method: l.method || 'GET', url: l.url || '', status, duration: dsec, error: l.error });
                } catch (e) { /* ignore parse error */ }
              });
              renderTable();
            }
          } catch (e) { /* ignore render support logs error */ }
        }
      } catch (e) { /* ignore support data fetch errors in UI log */ }
      try {
        if (j && Array.isArray(j.logs)) {
          log('--- Login API Logs ---');
          j.logs.forEach(l => {
            try {
              const when = formatTime(l.startTime || l.timestamp);
              const status = l.status || (l.error ? 'error' : 'unknown');
              const dur = Number(l.durationMs || 0);
              const dsec = (dur/1000).toFixed(2)+'s';
              pushLogEntry({ time: when, method: l.method, url: l.url, status, duration: dsec, error: l.error });
            } catch (e) { log('login log parse error'); }
          });
          renderTable();
          // end login logs
        }
      } catch (e) { /* ignore render login logs error */ }
    } else {
      // Login failed; keep logs minimal
      isAuthenticated = false;
      setVisibility(authView, true, 'block');
      setVisibility(appShell, false, 'flex');
      setVisibility(seedCard, false, 'block');
      setVisibility(supportCard, false, 'block');
    }
  });

  // logout removed — token is kept in-memory until page reload

  if (autoRunBtn) {
    autoRunBtn.addEventListener('click', async () => {
      const payload = {
        opts: {
          action: autoActionSelect ? autoActionSelect.value : 'createBasicPatients',
          mode: 'auto',
          count: Number(autoCount && autoCount.value ? autoCount.value : 1) || 1,
          concurrency: Number(autoConcurrency && autoConcurrency.value ? autoConcurrency.value : 0) || undefined,
          apiUrl: apiUrl.value,
          facilityId: Number(facilityId.value),
          username: username.value,
          password: password.value
        }
      };
      await executeSeedRun({
        payload,
        progressCtrl: progressControllers.auto,
        totalCount: Number(autoCount && autoCount.value ? autoCount.value : 1) || 1
      });
    });
  }

  if (contractsSendBtn) {
    contractsSendBtn.addEventListener('click', async () => {
      const isManual = contractsMode && contractsMode.value === 'manual';
      const payload = {
        opts: isManual ? {
          apiUrl: apiUrl.value,
          facilityId: Number(facilityId.value),
          count: Number(contractsManualCount && contractsManualCount.value ? contractsManualCount.value : 1) || 1,
          isHybridContract: false,
          contractType: contractType ? contractType.value : undefined,
          pctBilledCharges: (contractType && contractType.value === '% of Billed Charges' && contractPctBilledCharges && contractPctBilledCharges.value !== '') ? Number(contractPctBilledCharges.value) : undefined,
          effectiveDate: contractEffectiveDate ? contractEffectiveDate.value : undefined,
          expiryDate: contractExpiryDate ? contractExpiryDate.value : undefined,
          notes: contractNotes ? contractNotes.value : undefined
        } : {
          apiUrl: apiUrl.value,
          facilityId: Number(facilityId.value),
          count: Number(contractsAutoCount && contractsAutoCount.value ? contractsAutoCount.value : 1) || 1
        }
      };
      contractsSendBtn.disabled = true;
      if (contractsStatus) contractsStatus.textContent = 'Sending...';
      try {
        const res = await fetch('/contracts', { method: 'POST', headers: {'Content-Type':'application/json','token': token || ''}, body: JSON.stringify(payload) });
        const j = await res.json();
        if (j && Array.isArray(j.logs)) {
          j.logs.forEach(l => {
            const when = formatTime(l.startTime || l.timestamp);
            const status = l.status || (l.error ? 'error' : 'unknown');
            const dur = Number(l.durationMs || 0);
            const dsec = (dur/1000).toFixed(2) + 's';
            pushLogEntry({ time: when, method: l.method, url: l.url, status, duration: dsec, error: l.error });
          });
          renderTable();
        }
        if (contractsStatus) {
          const total = payload.opts.count;
          const successCount = (j && typeof j.successCount === 'number') ? j.successCount : undefined;
          const failureCount = (j && typeof j.failureCount === 'number') ? j.failureCount : undefined;
          contractsStatus.textContent = (successCount !== undefined)
            ? `Created ${successCount}/${total}${failureCount ? ` (${failureCount} failed)` : ''}`
            : (j && j.error ? `Failed: ${j.error}` : 'Done');
        }
      } catch (e) {
        if (contractsStatus) contractsStatus.textContent = 'Failed: network error';
      } finally {
        contractsSendBtn.disabled = false;
      }
    });
  }

  if (loginCollapseBtn) {
    loginCollapseBtn.addEventListener('click', () => {
      if (!loginCardBody) return;
      const isHidden = loginCardBody.classList.contains(HIDDEN_CLASS);
      if (isHidden) {
        setVisibility(loginCardBody, true, 'block');
        if (loginCollapseIcon) loginCollapseIcon.style.transform = 'rotate(0deg)';
        if (loginCollapseLabel) loginCollapseLabel.textContent = 'Collapse';
        if (loginCard) loginCard.classList.remove('collapsed');
      } else {
        setVisibility(loginCardBody, false, 'block');
        if (loginCollapseIcon) loginCollapseIcon.style.transform = 'rotate(-90deg)';
        if (loginCollapseLabel) loginCollapseLabel.textContent = 'Expand';
        if (loginCard) loginCard.classList.add('collapsed');
      }
    });
  }

  if (pwdToggle) {
    pwdToggle.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        const inp = document.getElementById('password');
        if (!inp) return;
        if (inp.type === 'password') {
          inp.type = 'text';
          pwdToggle.textContent = 'Hide';
          pwdToggle.title = 'Hide password';
          pwdToggle.setAttribute('aria-pressed','true');
        } else {
          inp.type = 'password';
          pwdToggle.textContent = 'Show';
          pwdToggle.title = 'Show password';
          pwdToggle.setAttribute('aria-pressed','false');
        }
      } catch (err) { /* pwdToggle error ignored */ }
    });
  }

  runBtn.addEventListener('click', async () => {
    // Gather selected labels for room, appointment type, physician
    const selRoomId = roomSelect && roomSelect.value ? Number(roomSelect.value) : undefined;
    const selRoomName = (roomSelect && roomSelect.selectedOptions && roomSelect.selectedOptions[0]) ? roomSelect.selectedOptions[0].textContent : undefined;
    // read DOS (YYYY-MM-DD from native input) and convert to ISO (UTC midnight)
    const selDOS = (() => {
      try {
        if (!dosInput) return undefined;
        const v = (dosInput.value || '').trim();
        if (!v) return undefined;
        const m = v.match(/^\s*(\d{4})-(\d{2})-(\d{2})\s*$/);
        if (!m) return undefined;
        const yyyy = Number(m[1]); const mm = Number(m[2]); const dd = Number(m[3]);
        const d = new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0));
        if (Number.isNaN(d.getTime())) return undefined;
        return d.toISOString();
      } catch (e) { return undefined; }
    })();
    const selApptTypeId = apptTypeSelect && apptTypeSelect.value ? Number(apptTypeSelect.value) : undefined;
    const selApptTypeName = (apptTypeSelect && apptTypeSelect.selectedOptions && apptTypeSelect.selectedOptions[0]) ? apptTypeSelect.selectedOptions[0].textContent : undefined;
    const selPhysicianId = physicianSelect && physicianSelect.value ? Number(physicianSelect.value) : undefined;
    const selPhysicianName = (physicianSelect && physicianSelect.selectedOptions && physicianSelect.selectedOptions[0]) ? physicianSelect.selectedOptions[0].textContent : undefined;
    // gather multiple selected CPTs (multi-select)
    const selCptValues = (() => {
      try {
        if (!cptSelect) return [];
        const opts = Array.from(cptSelect.selectedOptions || []);
        return opts.map(o => o.value).filter(v => v !== undefined && v !== null && String(v).trim() !== '');
      } catch (e) { return []; }
    })();
    const selFeeSchedules = (() => {
      try {
        if (!Array.isArray(_cachedCPTs) || !selCptValues.length) return [];
        return selCptValues.map(v => {
          const idNum = Number(v);
          return (_cachedCPTs || []).find(fs => {
            const pid = fs?.cptProcedure?.cptProcedureId ?? fs?.cptProcedureId ?? fs?.id;
            return Number(pid) === idNum;
          });
        }).filter(Boolean);
      } catch (e) { return []; }
    })();

    // Collect per-CPT amounts from native option elements
    const cptAmounts = (() => {
      try {
        if (!cptSelect) return {};
        const amounts = {};
        Array.from(cptSelect.options || []).forEach(o => {
          try {
            const id = String(o.value);
            if (!id) return;
            // only include amounts for selected options
            if (!o.selected) return;
            const raw = (typeof o._amount !== 'undefined') ? o._amount : (o.getAttribute && o.getAttribute('data-amount')) || '';
            const num = (raw === '' || raw === null || typeof raw === 'undefined') ? null : Number(raw);
            if (num === null || Number.isNaN(num)) {
              // skip empty amounts
            } else {
              amounts[id] = num;
            }
          } catch (e) {}
        });
        return amounts;
      } catch (e) { return {}; }
    })();

    const payload = {
      opts: {
        action: 'createBasicPatients',
        mode: 'manual',
        suffix: suffix.value,
        count: Number(count.value),
        concurrency: Number(concurrency && concurrency.value ? concurrency.value : 0) || undefined,
        apiUrl: apiUrl.value,
        facilityId: Number(facilityId.value),
        username: username.value,
        password: password.value
        , roomId: selRoomId
        , roomName: selRoomName
        , dos: selDOS
        , appointmentTypeId: selApptTypeId
        , appointmentTypeName: selApptTypeName
        , physicianId: selPhysicianId
        , physician: selPhysicianName
        , cptProcedureId: selCptValues.length ? Number(selCptValues[0]) : undefined
        , cptCode: selFeeSchedules.length ? (selFeeSchedules[0].cptProcedure?.cptCode ?? selFeeSchedules[0].cptCode) : undefined
        , feeScheduleOverride: selFeeSchedules.map(fs => {
            try {
              const pid = String(fs?.cptProcedure?.cptProcedureId ?? fs?.cptProcedureId ?? fs?.id ?? '');
              const copy = Object.assign({}, fs);
              if (cptAmounts && Object.prototype.hasOwnProperty.call(cptAmounts, pid)) {
                copy._amount = cptAmounts[pid];
              }
              return copy;
            } catch (e) { return fs; }
          })
        , cptAmounts: cptAmounts
        , periodBatch: (() => { try { const sel = document.querySelector('input[name="periodBatch"]:checked'); return sel ? sel.value : 'select'; } catch (e) { return 'select' } })()
        , periodId: (() => { try { return periodSelect && periodSelect.value ? periodSelect.value : undefined; } catch (e) { return undefined } })()
        , batchId: (() => { try { return batchSelect && batchSelect.value ? batchSelect.value : undefined; } catch (e) { return undefined } })()
        , insuranceType: (() => { try { const sel = document.querySelector('input[name="insuranceType"]:checked'); return sel ? sel.value : 'none'; } catch (e) { return 'none' } })()
        , insuranceId: (() => { try { return (insuranceSelect && insuranceSelect.value && document.querySelector('input[name="insuranceType"]:checked')?.value === 'select') ? insuranceSelect.value : undefined; } catch (e) { return undefined } })()
        , insuranceName: (() => { try { return (insuranceSelect && insuranceSelect.selectedOptions && document.querySelector('input[name="insuranceType"]:checked')?.value === 'select') ? insuranceSelect.selectedOptions[0].textContent : undefined; } catch (e) { return undefined } })()
        , insurancePriority: (() => { try { return (insuranceCreatePriorityWrap && insurancePriority && document.querySelector('input[name="insuranceType"]:checked')?.value === 'create') ? insurancePriority.value : undefined; } catch (e) { return undefined } })()
        , flowDepth: flowDepth ? Number(flowDepth.value) : 3
      }
    };
    await executeSeedRun({
      payload,
      progressCtrl: progressControllers.manual,
      totalCount: Number(count && count.value ? count.value : 1) || 1
    });
  });

  // Progress UI removed
})();
