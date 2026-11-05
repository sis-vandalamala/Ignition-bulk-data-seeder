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
// An entry goes to the call's own logFn when one is given, otherwise to the global logger.
// (Sending to both produced every log line twice whenever the caller passed the global logger as logFn.)
function emitLog(entry: ApiLogEntry, logFn?: (entry: ApiLogEntry) => void) {
	try {
		const deliver = () => {
			try {
				if (logFn) logFn(entry);
				else if (globalLogger) globalLogger(entry);
			} catch (e) {}
			// console fallback can be enabled explicitly in env for developer visibility
			try { consoleFallback(entry); } catch (e) {}
		};
		if (typeof setImmediate === 'function') setImmediate(deliver);
		else Promise.resolve().then(deliver);
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
export function formatErrorWithBody(err: any, resp?: any) {
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

// Human-readable, single-line description of a failed API call:
// "HTTP 400 POST /api/CaseSummaryComplex/Gemini/UpsertCaseSummary — {"message":"..."}"
// Falls back to the plain error message for non-HTTP errors (timeouts, ECONNRESET, thrown Errors).
export function describeApiError(err: any): string {
	if (!err) return 'Unknown error';
	const resp = err.response;
	const cfg = err.config;
	if (resp || cfg) {
		const method = cfg && cfg.method ? String(cfg.method).toUpperCase() : '';
		let path = '';
		try { path = cfg && cfg.url ? new URL(cfg.url).pathname : ''; } catch (e) { path = cfg && cfg.url ? String(cfg.url) : ''; }
		const where = [method, path].filter(Boolean).join(' ');
		if (!resp) {
			const code = err.code ? ` (${err.code})` : '';
			return `${where ? where + ': ' : ''}no response — ${err.message || String(err)}${code}`;
		}
		let body = '';
		try {
			const d = resp.data;
			if (d !== undefined && d !== null && d !== '') {
				body = typeof d === 'string' ? d : JSON.stringify(d);
				if (body.length > 1500) body = body.slice(0, 1500) + '…';
			}
		} catch (e) {}
		const emptyMsg = body === '' || body === '{"message":""}' ? ' (API returned no error message)' : '';
		return `HTTP ${resp.status} ${where}${body ? ' — ' + body : ''}${emptyMsg}`;
	}
	return err.message ? String(err.message) : String(err);
}

export async function deleteJson(url: string, timeout = 5000, headers?: Record<string, any>, logFn?: (entry: ApiLogEntry) => void) {
	const start = Date.now();
	const startIso = new Date(start).toISOString();
	const opts: any = { timeout };
	if (headers && Object.keys(headers).length) opts.headers = headers;
	try {
		const res = await axios.delete(url, opts);
		const end = Date.now();
		const endIso = new Date(end).toISOString();
		const duration = end - start;
		const entry: ApiLogEntry = { url, method: 'DELETE', status: res.status, durationMs: duration, startTime: startIso, endTime: endIso, timestamp: endIso };
		emitLog(entry, logFn);
		return res.data;
	} catch (err: any) {
		const end = Date.now();
		const endIso = new Date(end).toISOString();
		const duration = end - start;
		const resp = err && err.response ? err.response : undefined;
		const statusVal = resp && resp.status ? resp.status : 'error';
		const entry: ApiLogEntry = { url, method: 'DELETE', status: statusVal, durationMs: duration, error: formatErrorWithBody(err, resp), startTime: startIso, endTime: endIso, timestamp: endIso };
		emitLog(entry, logFn);
		throw err;
	}
}

// Network-level failures (connection reset / refused, DNS hiccups) with no HTTP response.
// Timeouts are excluded so a slow endpoint is not hit three times.
const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ERR_SOCKET_CONNECTION_TIMEOUT']);
const GET_MAX_ATTEMPTS = 3;

// GETs are idempotent, so dropped connections (seen as "read ECONNRESET" on the target API) are retried.
export async function getJson(url: string, timeout = 5000, headers?: Record<string, any>, logFn?: (entry: ApiLogEntry) => void) {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await getJsonOnce(url, timeout, headers, logFn);
		} catch (err: any) {
			const retryable = err && !err.response && RETRYABLE_NETWORK_CODES.has(String(err.code || ''));
			if (!retryable || attempt >= GET_MAX_ATTEMPTS) throw err;
			await new Promise((r) => setTimeout(r, 300 * attempt));
		}
	}
}

async function getJsonOnce(url: string, timeout = 5000, headers?: Record<string, any>, logFn?: (entry: ApiLogEntry) => void) {
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
			const entry: ApiLogEntry = { url, method: 'GET', status: statusVal, durationMs: duration, error: formatErrorWithBody(err, resp), startTime: startIso, endTime: endIso, timestamp: endIso };
		emitLog(entry, logFn);
		throw err;
	}
}
