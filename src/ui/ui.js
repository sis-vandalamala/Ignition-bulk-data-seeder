(()=>{
  const $ = id => document.getElementById(id);
  const mode = $('mode');
  const facilityId = $('facilityId');
  const apiUrl = $('apiUrl');
  const username = $('username');
  const password = $('password');
  const loginBtn = $('loginBtn');
  // logout button removed
  const suffix = $('suffix');
  const count = $('count');
  const concurrency = $('concurrency');
  const roomSelect = $('roomSelect');
  const apptTypeSelect = $('apptTypeSelect');
  const physicianSelect = $('physicianSelect');
  const runBtn = $('runBtn');
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
  const logEl = document.getElementById('logCard');
  const logTableBody = document.getElementById('logTableBody');
  const logFilter = document.getElementById('logFilter');
  const logClearBtn = document.getElementById('logClearBtn');
  const logAutoScroll = document.getElementById('logAutoScroll');
  const logBuffer = [];
  const elapsedEl = document.getElementById('elapsedDisplay');
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
      // Logged in — keep UI clean, skip noisy logs
      try { document.getElementById('seedCard').style.display = ''; } catch (e) {}
      try { document.getElementById('supportCard').style.display = ''; } catch (e) {}
      // populate selects from returned support data if present
      try {
        if (j.rooms && Array.isArray(j.rooms) && roomSelect) {
          roomSelect.innerHTML = j.rooms.map(r => {
            const value = r.roomId ?? r.RoomId ?? r.roomID ?? r.id ?? '';
            const label = r.name ?? r.roomName ?? r.RoomName ?? r.displayName ?? JSON.stringify(r);
            return `<option value="${value}">${label}</option>`;
          }).join('');
          // select first available
          if (roomSelect.options && roomSelect.options.length) roomSelect.selectedIndex = 0;
        }
        if (j.appointmentTypes && Array.isArray(j.appointmentTypes) && apptTypeSelect) {
          apptTypeSelect.innerHTML = j.appointmentTypes.map(a => {
            const value = a.appointmentTypeId ?? a.AppointmentTypeId ?? a.appointmentTypeID ?? a.id ?? '';
            const label = a.appointment_Type_Desc ?? a.appTypeDesc ?? a.description ?? a.name ?? JSON.stringify(a);
            return `<option value="${value}">${label}</option>`;
          }).join('');
          if (apptTypeSelect.options && apptTypeSelect.options.length) apptTypeSelect.selectedIndex = 0;
        }
        if (j.physicians && Array.isArray(j.physicians) && physicianSelect) {
          physicianSelect.innerHTML = j.physicians.map(p => {
            const value = p.personId ?? p.PersonId ?? p.id ?? '';
            const computedName = `${p.firstName || ''} ${p.lastName || ''}`.trim();
            const label = (p.fullName ?? p.FullName ?? p.name ?? computedName) || JSON.stringify(p);
            return `<option value="${value}">${label}</option>`;
          }).join('');
          if (physicianSelect.options && physicianSelect.options.length) physicianSelect.selectedIndex = 0;
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
              roomSelect.innerHTML = sup.rooms.map(r => {
                const value = r.roomId ?? r.RoomId ?? r.roomID ?? r.id ?? '';
                const label = r.name ?? r.roomName ?? r.RoomName ?? r.displayName ?? JSON.stringify(r);
                return `<option value="${value}">${label}</option>`;
              }).join('');
              if (roomSelect.options && roomSelect.options.length) roomSelect.selectedIndex = 0;
            }
            if (sup.appointmentTypes && Array.isArray(sup.appointmentTypes) && apptTypeSelect) {
              apptTypeSelect.innerHTML = sup.appointmentTypes.map(a => {
                const value = a.appointmentTypeId ?? a.AppointmentTypeId ?? a.appointmentTypeID ?? a.id ?? '';
                const label = a.appointment_Type_Desc ?? a.appTypeDesc ?? a.description ?? a.name ?? JSON.stringify(a);
                return `<option value="${value}">${label}</option>`;
              }).join('');
              if (apptTypeSelect.options && apptTypeSelect.options.length) apptTypeSelect.selectedIndex = 0;
            }
            if (sup.physicians && Array.isArray(sup.physicians) && physicianSelect) {
              physicianSelect.innerHTML = sup.physicians.map(p => {
                const value = p.personId ?? p.PersonId ?? p.id ?? '';
                const computedName = `${p.firstName || ''} ${p.lastName || ''}`.trim();
                const label = (p.fullName ?? p.FullName ?? p.name ?? computedName) || JSON.stringify(p);
                return `<option value="${value}">${label}</option>`;
              }).join('');
              if (physicianSelect.options && physicianSelect.options.length) physicianSelect.selectedIndex = 0;
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
    // reset elapsed display for this run (seconds)
    try { if (elapsedEl) elapsedEl.textContent = 'Total: 0.00s'; } catch (e) {}
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
        , room: roomSelect ? roomSelect.value : undefined
        , appointmentType: apptTypeSelect ? apptTypeSelect.value : undefined
        , physician: physicianSelect ? physicianSelect.value : undefined
        , flowDepth: flowDepth ? Number(flowDepth.value) : 3
      }
    };
    log('Sending seed request: ' + JSON.stringify(payload));
    const res = await fetch('/seed', { method: 'POST', headers: {'Content-Type':'application/json','token': token || ''}, body: JSON.stringify(payload) });
    const j = await res.json();
    log('Seed response: ' + JSON.stringify(j));
    // update progress stepper from response
    try { /* no progress UI to update */ } catch (e) {}
      // If run finished successfully, complete bar and keep visible
      try {
        if (j && j.ok) {
          setProgressPercent(100);
          // keep the bar visible after completion per request
        }
      } catch (e) {}
    try {
      // compute and show total elapsed time from logs (sum of durationMs)
      try {
        if (elapsedEl && j) {
          if (typeof j.runElapsedMs === 'number') {
            const s = (j.runElapsedMs/1000).toFixed(2);
            elapsedEl.textContent = `Total: ${s}s`;
          } else if (Array.isArray(j.logs) && j.logs.length) {
            // sum of durations (aggregate) and wall-clock elapsed (earliest start to latest end)
            let sumMs = 0;
            let minStart = Number.MAX_SAFE_INTEGER;
            let maxEnd = 0;
            j.logs.forEach(it => {
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
      if (j && Array.isArray(j.logs)) {
        log('--- API Call Logs ---');
        j.logs.forEach(l => {
          try {
            const when = formatTime(l.startTime || l.timestamp);
            const status = l.status || (l.error ? 'error' : 'unknown');
            const dur = Number(l.durationMs || 0);
            const dsec = (dur/1000).toFixed(2)+'s';
            logBuffer.unshift({ time: when, method: l.method, url: l.url, status, duration: dsec });
          } catch (e) { log('log parse error'); }
        });
        renderTable();
        // end logs
      }
    } catch (e) { /* ignore render logs error */ }
  });

  // Progress UI removed
})();
