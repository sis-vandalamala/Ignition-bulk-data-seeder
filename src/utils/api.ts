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
		// keep output minimal: method url status duration
		const dur = entry.durationMs != null ? `${entry.durationMs}ms` : '-';
		const status = entry.status != null ? String(entry.status) : 'unknown';
		// Use console.info to allow output without being too verbose
		try { console.info(`[api] ${entry.method} ${entry.url} ${status} ${dur}`); } catch (e) {}
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
			const entry: ApiLogEntry = { url, method: 'POST', status: statusVal, durationMs: duration, error: err && err.message ? err.message : String(err), startTime: startIso, endTime: endIso, timestamp: endIso };
		emitLog(entry, logFn);
		throw err;
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
