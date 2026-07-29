import axios from 'axios';

export type ApiLogEntry = {
	url: string;
	method: string;
	status?: number | string;
	durationMs?: number;
	error?: string;
	startTime?: string; // ISO
	endTime?: string; // ISO
	timestamp: string;
};

let globalLogger: ((entry: ApiLogEntry) => void) | undefined = undefined;

export function setGlobalApiLogger(fn?: (entry: ApiLogEntry) => void) {
	globalLogger = fn;
}

// Minimal non-blocking log emitter — uses setImmediate so it won't block the current
// event loop tick and keeps API call hot paths fast.
function emitLog(entry: ApiLogEntry, logFn?: (entry: ApiLogEntry) => void) {
	try {
		if (typeof setImmediate === 'function') {
			setImmediate(() => {
				try { if (logFn) logFn(entry); } catch (e) {}
				try { if (globalLogger) globalLogger(entry); } catch (e) {}
				// console fallback can be enabled explicitly in env for developer visibility
				try { consoleFallback(entry); } catch (e) {}
			});
		} else {
			// Fallback — schedule via Promise microtask to avoid blocking
			Promise.resolve().then(() => {
				try { if (logFn) logFn(entry); } catch (e) {}
				try { if (globalLogger) globalLogger(entry); } catch (e) {}
				// console fallback can be enabled explicitly in env for developer visibility
				try { consoleFallback(entry); } catch (e) {}
			});
		}
	} catch (e) {
		// swallow any logging errors to avoid affecting API paths
	}
}

// If no logger is configured, optionally print concise logs to console for dev visibility.
function consoleFallback(entry: ApiLogEntry) {
	try {
		const enabled = (process && process.env && (process.env.ENABLE_CONSOLE_LOGS === '1' || process.env.NODE_ENV !== 'production'));
		if (!enabled) return;
		const statusVal = entry.status;
		const statusStr = statusVal != null ? String(statusVal).toLowerCase() : '';
		const statusNum = typeof statusVal === 'number' ? statusVal : (Number.isFinite(Number(statusVal)) ? Number(statusVal) : NaN);
		const isErrorStatus = (!Number.isNaN(statusNum) && statusNum >= 400) || statusStr === 'error' || statusStr.startsWith('4') || statusStr.startsWith('5');
		const shouldLog = Boolean(entry.error) || isErrorStatus;
		if (!shouldLog) return;
		const dur = entry.durationMs != null ? `${entry.durationMs}ms` : '-';
		const status = entry.status != null ? String(entry.status) : 'error';
		try { console.error(`[api] ${entry.method} ${entry.url} ${status} ${dur}${entry.error ? ` :: ${entry.error}` : ''}`); } catch (e) {}
	} catch (e) { /* ignore fallback errors */ }
}

export async function postJson(url: string, payload: any, timeout = 5000, headers?: Record<string, any>, logFn?: (entry: ApiLogEntry) => void) {
	// debug logging suppressed
	const start = Date.now();
	const startIso = new Date(start).toISOString();
	const opts: any = { timeout };
	if (headers && Object.keys(headers).length) opts.headers = headers;
	try {
		const res = await axios.post(url, payload, opts);
		const end = Date.now();
		const endIso = new Date(end).toISOString();
		const duration = end - start;
		const entry: ApiLogEntry = { url, method: 'POST', status: res.status, durationMs: duration, startTime: startIso, endTime: endIso, timestamp: endIso };
		emitLog(entry, logFn);
		console.log(res)
		return res.data;
	} catch (err: any) {
			const end = Date.now();
			const endIso = new Date(end).toISOString();
			const duration = end - start;
			const resp = err && err.response ? err.response : undefined;
			const statusVal = resp && resp.status ? resp.status : 'error';
			const entry: ApiLogEntry = { url, method: 'POST', status: statusVal, durationMs: duration, error: formatErrorWithBody(err, resp), startTime: startIso, endTime: endIso, timestamp: endIso };
		emitLog(entry, logFn);
		throw err;
	}
}

export async function putJson(url: string, payload: any, timeout = 5000, headers?: Record<string, any>, logFn?: (entry: ApiLogEntry) => void) {
	const start = Date.now();
	const startIso = new Date(start).toISOString();
	const opts: any = { timeout };
	if (headers && Object.keys(headers).length) opts.headers = headers;
	try {
		const res = await axios.put(url, payload, opts);
		const end = Date.now();
		const endIso = new Date(end).toISOString();
		const duration = end - start;
		const entry: ApiLogEntry = { url, method: 'PUT', status: res.status, durationMs: duration, startTime: startIso, endTime: endIso, timestamp: endIso };
		emitLog(entry, logFn);
		return res.data;
	} catch (err: any) {
		const end = Date.now();
		const endIso = new Date(end).toISOString();
		const duration = end - start;
		const resp = err && err.response ? err.response : undefined;
		const statusVal = resp && resp.status ? resp.status : 'error';
		const entry: ApiLogEntry = { url, method: 'PUT', status: statusVal, durationMs: duration, error: formatErrorWithBody(err, resp), startTime: startIso, endTime: endIso, timestamp: endIso };
		emitLog(entry, logFn);
		throw err;
	}
}

// Include the response body in the logged error so validation/conflict reasons
// from the target API (e.g. "duplicate name", "facilityId required") are visible
// in the Output Log instead of just a generic "Request failed with status code X".
function formatErrorWithBody(err: any, resp?: any) {
	let base = err && err.message ? err.message : String(err);
	if (!resp) return base;
	const allowHeader = resp.headers && (resp.headers.allow || resp.headers.Allow);
	if (allowHeader) base = `${base} :: Allow: ${allowHeader}`;
	if (resp.data === undefined || resp.data === null) return base;
	try {
		const bodyStr = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
		return bodyStr ? `${base} :: ${bodyStr}` : base;
	} catch (e) {
		return base;
	}
}

export async function getJson(url: string, timeout = 5000, headers?: Record<string, any>, logFn?: (entry: ApiLogEntry) => void) {
	// debug logging suppressed
	const start = Date.now();
	const startIso = new Date(start).toISOString();
	const opts: any = { timeout };
	if (headers && Object.keys(headers).length) opts.headers = headers;
	try {
		const res = await axios.get(url, opts);
		const end = Date.now();
		const endIso = new Date(end).toISOString();
		const duration = end - start;
		const entry: ApiLogEntry = { url, method: 'GET', status: res.status, durationMs: duration, startTime: startIso, endTime: endIso, timestamp: endIso };
		emitLog(entry, logFn);
		return res.data;
	} catch (err: any) {
			const end = Date.now();
			const endIso = new Date(end).toISOString();
			const duration = end - start;
			const resp = err && err.response ? err.response : undefined;
			const statusVal = resp && resp.status ? resp.status : 'error';
			const entry: ApiLogEntry = { url, method: 'GET', status: statusVal, durationMs: duration, error: err && err.message ? err.message : String(err), startTime: startIso, endTime: endIso, timestamp: endIso };
		emitLog(entry, logFn);
		throw err;
	}
}
