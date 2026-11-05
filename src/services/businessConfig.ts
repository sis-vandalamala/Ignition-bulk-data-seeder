import { getJson, type ApiLogEntry } from '../utils/api';

// Feature 247 "Business Office Granular Permissions".
// When it is ON the SIS Enterprise app uses the /api/facility/business/... routes; when it is OFF
// those routes answer 403 "Feature [...] not found" and the app uses the legacy controller routes
// (InsuranceContract/..., TransactionCode/..., CaseFlag/...). The seeder picks the same route the app would.
export const FEATURE_BUSINESS_OFFICE_GRANULAR_PERMISSIONS = 247;

export function apiRoot(apiBaseUrl: string) {
	return String(apiBaseUrl).replace(/\/+$/, '') + '/api';
}

export function jsonHeaders(token: string, extra?: Record<string, string>) {
	return Object.assign({
		accept: 'application/json, text/plain, */*',
		'content-type': 'application/json;charset=UTF-8',
		token,
	}, extra || {});
}

export async function getFeatureStates(apiBaseUrl: string, token: string, logFn?: (e: ApiLogEntry) => void): Promise<Record<string, boolean>> {
	try {
		const res = await getJson(`${apiRoot(apiBaseUrl)}/v2/feature/states/all`, 15000, { token, Accept: 'application/json' }, logFn);
		return res && typeof res === 'object' ? res : {};
	} catch (e) {
		return {};
	}
}

export async function useGranularBusinessRoutes(apiBaseUrl: string, token: string, logFn?: (e: ApiLogEntry) => void) {
	const states = await getFeatureStates(apiBaseUrl, token, logFn);
	return states[String(FEATURE_BUSINESS_OFFICE_GRANULAR_PERMISSIONS)] === true;
}

export function randomLetters(n: number) {
	const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	let s = '';
	for (let i = 0; i < n; i += 1) s += a.charAt(Math.floor(Math.random() * a.length));
	return s;
}

export function uniqueSuffix() {
	return `${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}
