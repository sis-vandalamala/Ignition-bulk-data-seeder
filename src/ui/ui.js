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
  const runBtn = $('runBtn');
  const pwdToggle = document.getElementById('pwdToggle');

  let token = null;
  const logEl = document.getElementById('logCard');
  const elapsedEl = document.getElementById('elapsedDisplay');
  function log(msg){
    try{
      const when = new Date().toISOString().slice(11,19);
      logEl.textContent = `${when}  ${msg}\n` + logEl.textContent;
      // keep newest at top; ensure visible
      logEl.scrollTop = 0;
    }catch(e){ /* ignore UI log append errors */ }
  }

  loginBtn.addEventListener('click', async () => {
    const res = await fetch('/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username: username.value, password: password.value, facilityId: Number(facilityId.value), apiUrl: apiUrl.value }) });
    const j = await res.json();
    if (j && j.ok && j.token) {
      token = j.token;
      log('Logged in — token stored in-memory');
      try {
        if (j && Array.isArray(j.logs)) {
          log('--- Login API Logs ---');
          j.logs.forEach(l => {
            try {
              const when = new Date(l.timestamp).toISOString().slice(11,19);
              const status = l.status || (l.error ? 'error' : 'unknown');
              log(`${when}  ${l.method} ${l.url} => ${status} (${l.durationMs || 0}ms)`);
            } catch (e) { log('login log parse error'); }
          });
          log('--- end login logs ---');
        }
      } catch (e) { log('render login logs error'); }
    } else {
      log('Login failed: ' + JSON.stringify(j));
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
      }
    };
    log('Sending seed request: ' + JSON.stringify(payload));
    const res = await fetch('/seed', { method: 'POST', headers: {'Content-Type':'application/json','token': token || ''}, body: JSON.stringify(payload) });
    const j = await res.json();
    log('Seed response: ' + JSON.stringify(j));
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
            const when = l.startTime ? new Date(l.startTime).toISOString().slice(11,19) : (new Date(l.timestamp).toISOString().slice(11,19));
            const status = l.status || (l.error ? 'error' : 'unknown');
            const d = Number(l.durationMs) || 0;
            const dsec = (d/1000).toFixed(2);
            const times = (l.startTime && l.endTime) ? ` [${new Date(l.startTime).toISOString().slice(11,19)} → ${new Date(l.endTime).toISOString().slice(11,19)}]` : '';
            log(`${when}  ${l.method} ${l.url} => ${status} (${dsec}s)${times}`);
          } catch (e) { log('log parse error'); }
        });
        log('--- end logs ---');
      }
    } catch (e) { log('render logs error'); }
  });
})();
