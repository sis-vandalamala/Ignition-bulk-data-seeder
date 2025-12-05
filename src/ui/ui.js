(()=>{
  const $ = id => document.getElementById(id);
  const mode = $('mode');
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
  // logout button removed
  const suffix = $('suffix');
  const count = $('count');
  const concurrency = $('concurrency');
  const roomSelect = $('roomSelect');
  const apptTypeSelect = $('apptTypeSelect');
  const physicianSelect = $('physicianSelect');
  const cptSelect = $('cptSelect');
  const dosInput = $('dos');
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
  // in-list floating search will be created dynamically on focus/click
  const runBtn = $('runBtn');
  const logoEl = document.querySelector('.logo');
  const pwdToggle = document.getElementById('pwdToggle');
  // workflow depth slider (0 create,1 discharge,2 cases-to-code,3 charge entry)
  const flowDepth = $('flowDepth');
  const flowDepthLabel = $('flowDepthLabel');
  const flowSteps = $('flowSteps');
  function updateFlowDepthLabel(){
    if (!flowDepth || !flowDepthLabel) return;
    const v = Number(flowDepth.value);
    let txt = '';
    if (v===0) txt = 'Create only (patient + case summary)';
    else if (v===1) txt = 'Through Discharge';
    else if (v===2) txt = 'Through Cases-to-Code (no charge entry)';
    else txt = 'Full: Charge Entry';
    flowDepthLabel.textContent = txt;
    try { flowDepthLabel.dataset.depth = String(v); } catch (e) {}
    try { flowDepth.dataset.depth = String(v); } catch (e) {}
    // Single-color progress fill (accent1) up to current depth
    try {
      const pct = Math.min(100, Math.max(0, (v/3)*100));
      flowDepth.style.background = `linear-gradient(90deg, var(--trackFill) 0%, var(--trackFill) ${pct}%, var(--trackBg) ${pct}%)`;
    } catch (e) {}
    // update step dots
    if (flowSteps){
      const children = flowSteps.querySelectorAll('.flow-step');
      children.forEach(el => {
        const step = Number(el.getAttribute('data-step'));
        el.classList.remove('active','completed','final');
        if (step === v) el.classList.add('active');
        if (step < v) el.classList.add('completed');
        if (v === 3 && step === 3) el.classList.add('final');
      });
    }
  }
  if (flowDepth) flowDepth.addEventListener('input', updateFlowDepthLabel);
  // Allow clicking dots to set depth
  if (flowSteps){
    flowSteps.addEventListener('click', (e) => {
      const target = e.target.closest('.flow-step');
      if (!target) return;
      const step = Number(target.getAttribute('data-step'));
      if (flowDepth){ flowDepth.value = String(step); updateFlowDepthLabel(); }
    });
  }
  updateFlowDepthLabel();

  let token = null;
  // cached option data for search filtering
  let _cachedRooms = null;
  let _cachedAppts = null;
  let _cachedPhysicians = null;
  let _cachedCPTs = null;
  const logEl = document.getElementById('logCard');
  const logTableBody = document.getElementById('logTableBody');
  const logFilter = document.getElementById('logFilter');
  const logClearBtn = document.getElementById('logClearBtn');
  const logAutoScroll = document.getElementById('logAutoScroll');
  const logBuffer = [];
  const elapsedEl = document.getElementById('elapsedDisplay');
  const runProgressFill = document.getElementById('runProgressFill');
  const runProgressLabel = document.getElementById('runProgressLabel');
  const runProgressWrap = document.getElementById('runProgressWrap');
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
        <td style=\"padding:6px 8px;color:${statusColor};white-space:nowrap\">${r.status}</td>
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

  // Progress helpers
  let _animTimer = null;
  let _currentPct = 0;
  let _finalized = false;
  function setProgressPercent(pct, text) {
    try {
      const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
      _currentPct = clamped;
      if (runProgressFill) runProgressFill.style.width = clamped + '%';
      // do not overwrite final status text once finalized
      if (!(_finalized)) {
        if (runProgressLabel) runProgressLabel.textContent = text || (clamped === 0 ? 'Idle' : `${clamped}%`);
      }
    } catch (e) {}
  }

  function animateIndeterminate() {
    // simple looping progress animation while waiting for server
    let v = 0;
    clearInterval(_animTimer);
    _animTimer = setInterval(() => {
      v = (v + 7) % 100;
      setProgressPercent(v, 'Running...');
    }, 250);
  }

  function stopIndeterminate() {
    try { clearInterval(_animTimer); _animTimer = null; } catch (e) {}
  }

  function setStatusResult(result, pct) {
    try {
      if (!runProgressLabel) return;
      const effectivePct = (typeof pct === 'number') ? Math.max(0, Math.min(100, Math.round(pct))) : Math.max(0, Math.min(100, Math.round(_currentPct || 0)));
      if (result === 'pass') {
        _finalized = true;
        runProgressLabel.textContent = `${effectivePct}% · Successful`;
      } else if (result === 'fail') {
        _finalized = true;
        runProgressLabel.textContent = `${effectivePct}% · Failed`;
      } else {
        _finalized = false;
        runProgressLabel.textContent = `${effectivePct}%`;
      }
    } catch (e) {}
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
                logBuffer.unshift({ time: when, method: l.method || 'GET', url: l.url || '', status, duration: dsec });
              }
              renderTable();
            }
            lastCount = j2.logs.length;
          }
        } catch (e) { /* ignore merge errors */ }

        // update percent if provided
        try {
          if (typeof j2.completedCount === 'number' && typeof count !== 'undefined') {
            const total = Number(count && count.value ? count.value : 1) || 1;
            const done = Number(j2.completedCount || 0);
            const pct = Math.round(Math.min(100, (done / Math.max(1, total)) * 100));
            setProgressPercent(pct, `${pct}%`);
          } else if (typeof j2.percent === 'number') {
            setProgressPercent(j2.percent, `${Math.round(j2.percent)}%`);
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
        cb.addEventListener('change', (e) => {
          try {
            const o = Array.from(selectEl.options || []).find(o2 => String(o2.value) === id);
            if (o) o.selected = cb.checked;
            // update display text
            const selCount = (selectEl.selectedOptions && selectEl.selectedOptions.length) ? selectEl.selectedOptions.length : 0;
            display.textContent = selCount ? `${selCount} selected` : 'Select...';
            const ev = new Event('change', { bubbles: true });
            try { selectEl.dispatchEvent(ev); } catch (e) {}
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
        item.addEventListener('click', (ev) => {
          // avoid double toggling when clicking checkbox
          if (ev.target === cb) return;
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
      try { document.getElementById('seedCard').style.display = ''; } catch (e) {}
      try { document.getElementById('supportCard').style.display = ''; } catch (e) {}
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
          } catch (e) { /* ignore populate support selects error */ }
          try {
            if (sup && Array.isArray(sup.logs)) {
              sup.logs.forEach(l => {
                try {
                  const when = formatTime(l.startTime || l.timestamp);
                  const status = l.status || (l.error ? 'error' : 'unknown');
                  const dur = Number(l.durationMs || 0);
                  const dsec = (dur/1000).toFixed(2) + 's';
                  logBuffer.unshift({ time: when, method: l.method || 'GET', url: l.url || '', status, duration: dsec });
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
              logBuffer.unshift({ time: when, method: l.method, url: l.url, status, duration: dsec });
            } catch (e) { log('login log parse error'); }
          });
          renderTable();
          // end login logs
        }
      } catch (e) { /* ignore render login logs error */ }
    } else {
      // Login failed; keep logs minimal
      try { document.getElementById('seedCard').style.display = 'none'; } catch (e) {}
      try { document.getElementById('supportCard').style.display = 'none'; } catch (e) {}
    }
  });

  // logout removed — token is kept in-memory until page reload

  if (loginCollapseBtn) {
    loginCollapseBtn.addEventListener('click', () => {
      if (!loginCardBody) return;
      const isHidden = loginCardBody.style.display === 'none';
      if (isHidden) {
        loginCardBody.style.display = 'block';
        if (loginCollapseIcon) loginCollapseIcon.style.transform = 'rotate(0deg)';
        if (loginCollapseLabel) loginCollapseLabel.textContent = 'Collapse';
        if (loginCard) loginCard.classList.remove('collapsed');
      } else {
        loginCardBody.style.display = 'none';
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
    try { if (logoEl) logoEl.classList.add('running'); } catch (e) {}
    // reset elapsed display for this run (seconds)
    try { if (elapsedEl) elapsedEl.textContent = 'Total: 0.00s'; } catch (e) {}
    // reset progress and result
    stopIndeterminate(); setProgressPercent(0, 'Starting...'); setStatusResult(null);
    // show progress wrapper when Run clicked
    try { if (runProgressWrap) runProgressWrap.style.display = ''; } catch (e) {}
    // ensure label doesn't show old result
    try { if (runProgressLabel) runProgressLabel.textContent = 'Starting...'; } catch (e) {}
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

    const payload = {
      opts: {
        action: 'createBasicPatients',
        mode: mode.value,
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
        , feeScheduleOverride: selFeeSchedules
        , flowDepth: flowDepth ? Number(flowDepth.value) : 3
      }
    };
    log('Sending seed request: ' + JSON.stringify(payload));
    // start indeterminate animation until server responds
    animateIndeterminate();
    let j = null;
    
    try {
      const res = await fetch('/seed', { method: 'POST', headers: {'Content-Type':'application/json','token': token || ''}, body: JSON.stringify(payload) });
      try { j = await res.json(); } catch (e) { j = { ok: false, error: 'invalid-json' }; }
    } catch (e) {
      j = { ok: false, error: String(e) };
    }
    stopIndeterminate();
    try { if (logoEl) logoEl.classList.remove('running'); } catch (e) {}
    log('Seed response: ' + JSON.stringify(j));
    // If server returned a runId, poll for incremental logs/status and merge them live
    let finalResp = j;
    try {
      if (j && j.runId) {
        // start polling and merge results — pollRunStatus returns final combined object
        const polled = await pollRunStatus(j.runId, { intervalMs: 800, maxPolls: 900 });
        if (polled && typeof polled === 'object') {
          finalResp = Object.assign({}, j, polled);
        }
      }
    } catch (e) {
      // ignore polling errors and fall back to original response
    }
    // compute and show total elapsed time from logs (sum of durationMs)
    try {
      try {
        if (elapsedEl && finalResp) {
          if (typeof finalResp.runElapsedMs === 'number') {
            const s = (finalResp.runElapsedMs/1000).toFixed(2);
            elapsedEl.textContent = `Total: ${s}s`;
          } else if (Array.isArray(finalResp.logs) && finalResp.logs.length) {
            // sum of durations (aggregate) and wall-clock elapsed (earliest start to latest end)
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

      // merge all logs into the UI buffer (most recent first)
      if (finalResp && Array.isArray(finalResp.logs)) {
        log('--- API Call Logs ---');
        finalResp.logs.forEach(l => {
          try {
            const when = formatTime(l.startTime || l.timestamp);
            const status = l.status || (l.error ? 'error' : 'unknown');
            const dur = Number(l.durationMs || 0);
            const dsec = (dur/1000).toFixed(2)+'s';
            logBuffer.unshift({ time: when, method: l.method, url: l.url, status, duration: dsec });
          } catch (e) { /* ignore per-log parse error */ }
        });
        // compute a simple progress percent and failure count
        let failureCount = 0;
        try {
          const total = Number(count && count.value ? count.value : (finalResp.logs.length || 1)) || 1;
          // count failures conservatively
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
          setProgressPercent(pct, `${pct}%`);
        } catch (e) { /* ignore progress calc error */ }
        renderTable();
        // decide final status
        if (failureCount > 0) {
          setProgressPercent(100, 'Completed');
          setStatusResult('fail', _currentPct);
        } else if (finalResp && finalResp.ok) {
          setProgressPercent(100, 'Completed');
          setStatusResult('pass', 100);
        } else {
          setProgressPercent(100, 'Completed');
          setStatusResult('fail', 100);
        }
      } else {
        // no logs — fallback to j.ok
        if (finalResp && finalResp.ok) {
          setProgressPercent(100, 'Completed');
          setStatusResult('pass', 100);
        } else {
          setProgressPercent(100, 'Completed');
          setStatusResult('fail', 100);
        }
      }
    } catch (e) { setStatusResult('fail', _currentPct); }
  });

  // Progress UI removed
})();
