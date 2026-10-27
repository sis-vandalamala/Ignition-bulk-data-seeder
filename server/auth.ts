import { postJson, getJson } from '../src/utils/api';

// Facility entityType values returned by GET /api/enterprise/facility/{id}
export const ENTITY_TYPE_ANESTHESIA_BILLING = 2;

function resolveBase(url: string) {
	if (!url) return url;
	return String(url).replace(/\/$/, '');
}

export async function loginUser(apiUrl: string | undefined, username: string, password: string, facility?: number, logFn?: (entry: import('../src/utils/api').ApiLogEntry) => void, orgTypeOverride?: string) {
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
				return { ok: true, token, orgId, sessionError: e && e.message ? e.message : String(e), isAnesthesiaBilling: false };
			}
		}

		// Detect organization type: explicit override -> enterprise facility API -> external facilities probe.
		// Detection calls are not logged: the enterprise API returns 403 ("Session not connected to Enterprise")
		// for facility-level sessions, which is expected and handled by the fallback.
		let entityType: number | undefined = undefined;
		let isAnesthesiaBilling = false;
		let orgTypeSource: 'override' | 'enterprise-api' | 'external-facilities' | 'default' = 'default';
		const ov = String(orgTypeOverride || '').toLowerCase();
		if (ov === 'anesthesia' || ov === 'clinical') {
			isAnesthesiaBilling = ov === 'anesthesia';
			entityType = isAnesthesiaBilling ? ENTITY_TYPE_ANESTHESIA_BILLING : 1;
			orgTypeSource = 'override';
		} else if (orgId) {
			const headers = { token, Accept: 'application/json' };
			try {
				const fac = await getJson(`${base}/api/enterprise/facility/${orgId}`, 10000, headers);
				if (fac && typeof fac.entityType === 'number') {
					entityType = fac.entityType;
					isAnesthesiaBilling = entityType === ENTITY_TYPE_ANESTHESIA_BILLING;
					orgTypeSource = 'enterprise-api';
				}
			} catch { /* fall through to probe */ }
			if (orgTypeSource === 'default') {
				try {
					const ef = await getJson(`${base}/api/AnesthesiaBillingConfiguration/Get/ExternalFacilities/List/${orgId}/false`, 10000, headers);
					if (Array.isArray(ef) && ef.some((f: any) => f && typeof f.extOrganizationId === 'number')) {
						isAnesthesiaBilling = true;
						entityType = ENTITY_TYPE_ANESTHESIA_BILLING;
						orgTypeSource = 'external-facilities';
					}
				} catch { /* treat as clinical */ }
			}
		}

		return { ok: true, token, orgId, sessionInfo, entityType, isAnesthesiaBilling, orgTypeSource };
	} catch (err: any) {
		const msg = err && err.message ? err.message : String(err);
		return { ok: false, error: msg };
	}
}

export async function logoutUser(_token?: string) {
	return { ok: true };
}
