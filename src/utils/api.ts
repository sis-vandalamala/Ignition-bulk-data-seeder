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

export async function postJson(url: string, payload: any, timeout = 5000, headers?: Record<string, any>, logFn?: (entry: ApiLogEntry) => void) {
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
		try { if (logFn) logFn(entry); } catch (e) {}
		try { if (globalLogger) globalLogger(entry); } catch (e) {}
		return res.data;
	} catch (err: any) {
		const end = Date.now();
		const endIso = new Date(end).toISOString();
		const duration = end - start;
		const entry: ApiLogEntry = { url, method: 'POST', status: 'error', durationMs: duration, error: err && err.message ? err.message : String(err), startTime: startIso, endTime: endIso, timestamp: endIso };
		try { if (logFn) logFn(entry); } catch (e) {}
		try { if (globalLogger) globalLogger(entry); } catch (e) {}
		throw err;
	}
}

export async function getJson(url: string, timeout = 5000, headers?: Record<string, any>, logFn?: (entry: ApiLogEntry) => void) {
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
		try { if (logFn) logFn(entry); } catch (e) {}
		try { if (globalLogger) globalLogger(entry); } catch (e) {}
		return res.data;
	} catch (err: any) {
		const end = Date.now();
		const endIso = new Date(end).toISOString();
		const duration = end - start;
		const entry: ApiLogEntry = { url, method: 'GET', status: 'error', durationMs: duration, error: err && err.message ? err.message : String(err), startTime: startIso, endTime: endIso, timestamp: endIso };
		try { if (logFn) logFn(entry); } catch (e) {}
		try { if (globalLogger) globalLogger(entry); } catch (e) {}
		throw err;
	}
}
