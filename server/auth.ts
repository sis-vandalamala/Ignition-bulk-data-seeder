import { postJson } from '../src/utils/api';

function resolveBase(url: string) {
	if (!url) return url;
	return String(url).replace(/\/$/, '');
}

export async function loginUser(apiUrl: string | undefined, username: string, password: string, facility?: number, logFn?: (entry: import('../src/utils/api').ApiLogEntry) => void) {
	if (!apiUrl) return { ok: false, error: 'no apiUrl provided' };
	try {
		const base = resolveBase(apiUrl);
		const loginUrl = `${base}/api/Login/LoginUser`;
		const body = { userName: username, password };
		const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
		const data = await postJson(loginUrl, body, 10000, headers, logFn);
		// extract token from common shapes
		let token: string | undefined = undefined;
		if (!data) token = undefined;
		else if (typeof data === 'string') {
			try { const parsed = JSON.parse(data); token = parsed && (parsed.token || parsed.access_token || parsed.accessToken); } catch { token = data; }
		} else if (typeof data === 'object') {
			token = data.token || data.access_token || data.accessToken || data;
			if (typeof token === 'object') token = undefined;
		}

		if (!token) {
			// fallback: maybe API placed token in a property deep inside
			if (data && data.result && (data.result.token || data.result.access_token)) token = data.result.token || data.result.access_token;
		}

		if (!token) return { ok: false, error: 'login failed or token not found', data };

		// call UserSessionOrg to bind session to the org/facility
		const orgId = facility && Number(facility) ? Number(facility) : undefined;
		let sessionInfo: any = undefined;
		if (orgId) {
			try {
				const sessUrl = `${base}/api/UserSession/UserSessionOrg/${orgId}`;
				sessionInfo = await postJson(sessUrl, {}, 10000, { token }, logFn);
			} catch (e: any) {
				// non-fatal: return login token but include session error
				return { ok: true, token, orgId, sessionError: e && e.message ? e.message : String(e) };
			}
		}

		return { ok: true, token, orgId, sessionInfo };
	} catch (err: any) {
		const msg = err && err.message ? err.message : String(err);
		return { ok: false, error: msg };
	}
}

export async function logoutUser(_token?: string) {
	return { ok: true };
}
