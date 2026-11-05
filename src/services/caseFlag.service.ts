import { getJson, postJson, describeApiError, type ApiLogEntry } from '../utils/api';
import { apiRoot, jsonHeaders, randomLetters, uniqueSuffix } from './businessConfig';

// Case Flagging configuration (Configuration → Facility → Case Flags).
// Saving requires the org-level configuration lock the app takes when the page opens:
//   POST Security/RecordLock/RequestLock { recordLockTypeId: 27, organizationId }
// A null response means the lock was granted; otherwise the response is the user holding it.
const CASE_FLAG_CONFIG_LOCK_TYPE = 27;
export const CASE_FLAG_VISIBILITY: Record<string, number> = { Clinical: 1, Business: 2, Both: 3 };

export type CaseFlagColor = { caseFlagColorId: number; name: string; color?: string };

export async function getCaseFlagColors(apiBaseUrl: string, token: string, logFn?: (e: ApiLogEntry) => void): Promise<CaseFlagColor[]> {
	const res = await getJson(`${apiRoot(apiBaseUrl)}/CaseFlag/Colors`, 15000, { token, Accept: 'application/json' }, logFn);
	return Array.isArray(res) ? res : [];
}

export async function getCaseFlagConfigs(apiBaseUrl: string, token: string, logFn?: (e: ApiLogEntry) => void): Promise<any[]> {
	const res = await getJson(`${apiRoot(apiBaseUrl)}/CaseFlag/Config`, 15000, { token, Accept: 'application/json' }, logFn);
	return Array.isArray(res) ? res : [];
}

export type CreateCaseFlagsOptions = {
	apiBaseUrl: string;
	token: string;
	organizationId: number;
	count?: number;
	mode?: 'auto' | 'manual';
	flagName?: string;
	abbreviation?: string;
	color?: string; // color name (from CaseFlag/Colors) or id
	visibility?: string; // Clinical | Business | Both
	extraHeaders?: Record<string, string>;
	logFn?: (entry: ApiLogEntry) => void;
};

export type CaseFlagAttemptResult = {
	ok: boolean;
	index: number;
	caseFlagName: string;
	abbreviation: string;
	caseFlagId?: number;
	color?: string;
	visibility?: string;
	error?: string;
};

export async function createCaseFlags(opts: CreateCaseFlagsOptions): Promise<{ results: CaseFlagAttemptResult[]; error?: string }> {
	if (!opts.apiBaseUrl) throw new Error('apiBaseUrl is required');
	if (!opts.token) throw new Error('Not logged in (no token)');
	if (!opts.organizationId) throw new Error('Facility (organization) id is required for case flags');
	const api = apiRoot(opts.apiBaseUrl);
	const headers = jsonHeaders(opts.token, opts.extraHeaders);
	const total = Math.max(1, Number(opts.count) || 1);
	// Saving always goes through CaseFlag/Config (the granular feature only adds a GET route for configs).
	const colors = await getCaseFlagColors(opts.apiBaseUrl, opts.token, opts.logFn).catch(() => [] as CaseFlagColor[]);
	if (!colors.length) throw new Error('CaseFlag/Colors returned no colors; cannot create case flags');
	const pickColor = (): CaseFlagColor => {
		if (opts.mode !== 'auto' && opts.color) {
			const want = String(opts.color).trim().toLowerCase();
			const found = colors.find((c) => String(c.caseFlagColorId) === want || String(c.name).toLowerCase() === want);
			if (!found) throw new Error(`Color "${opts.color}" is not available. Available: ${colors.map((c) => c.name).join(', ')}`);
			return found;
		}
		return colors[Math.floor(Math.random() * colors.length)];
	};
	const visibilityNames = Object.keys(CASE_FLAG_VISIBILITY);
	const existing = await getCaseFlagConfigs(opts.apiBaseUrl, opts.token, opts.logFn).catch(() => [] as any[]);
	const usedNames = new Set(existing.map((f: any) => String(f.caseFlagName || '').toLowerCase()));
	const usedAbbr = new Set(existing.map((f: any) => String(f.abbreviation || '').toUpperCase()));

	const lockBody = { recordLockTypeId: CASE_FLAG_CONFIG_LOCK_TYPE, organizationId: opts.organizationId };
	let lockRes: any;
	try {
		lockRes = await postJson(`${api}/Security/RecordLock/RequestLock`, lockBody, 15000, headers, opts.logFn);
	} catch (e) {
		throw new Error(`Could not lock the Case Flags configuration: ${describeApiError(e)}`);
	}
	if (lockRes) {
		const who = lockRes.staffName ? String(lockRes.staffName).replace(/\s+/g, ' ').trim() : 'another session';
		throw new Error(`The Case Flags configuration for org ${opts.organizationId} is locked by ${who} in another session (e.g. the Case Flags page is open in the SIS app, or a browser session ended without logging out). Close that page / log that session out, or wait for the lock to expire, then retry.`);
	}

	const results: CaseFlagAttemptResult[] = [];
	try {
		for (let i = 1; i <= total; i += 1) {
			let caseFlagName = '';
			let abbreviation = '';
			let color: CaseFlagColor | undefined;
			let visibility = '';
			try {
				color = pickColor();
				visibility = opts.mode === 'auto' ? visibilityNames[Math.floor(Math.random() * visibilityNames.length)] : (opts.visibility || 'Clinical');
				if (!CASE_FLAG_VISIBILITY[visibility]) throw new Error(`Unknown flag visibility "${visibility}" (expected Clinical, Business or Both)`);
				if (opts.mode === 'auto' || !opts.flagName) {
					caseFlagName = `Seed Flag ${uniqueSuffix()}`;
				} else {
					caseFlagName = total > 1 ? `${opts.flagName} ${i}` : opts.flagName;
				}
				if (opts.mode !== 'auto' && opts.abbreviation && total === 1) {
					abbreviation = String(opts.abbreviation).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
				} else {
					// unique 2-letter abbreviation; start from the user's first letter when given
					const lead = (opts.abbreviation || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);
					for (let tries = 0; tries < 200; tries += 1) {
						abbreviation = lead ? lead + randomLetters(1) : randomLetters(2);
						if (!usedAbbr.has(abbreviation)) break;
					}
				}
				if (abbreviation.length !== 2) throw new Error('Abbreviation must be 2 letters');
				if (usedNames.has(caseFlagName.toLowerCase())) throw new Error(`A case flag named "${caseFlagName}" already exists in this org`);
				const saved = await postJson(`${api}/CaseFlag/Config`, {
					caseFlagId: 0,
					organizationId: opts.organizationId,
					caseFlagColorId: color.caseFlagColorId,
					activeTf: true,
					caseFlagName,
					abbreviation,
					caseFlagVisibility: CASE_FLAG_VISIBILITY[visibility],
					sortOrder: 0,
				}, 20000, headers, opts.logFn);
				usedNames.add(caseFlagName.toLowerCase());
				usedAbbr.add(abbreviation);
				results.push({ ok: true, index: i, caseFlagName, abbreviation, caseFlagId: saved && saved.caseFlagId, color: color.name, visibility });
			} catch (err: any) {
				const msg = err && err.response ? `Save case flag failed: ${describeApiError(err)}` : (err && err.message ? err.message : String(err));
				results.push({ ok: false, index: i, caseFlagName, abbreviation, color: color && color.name, visibility, error: msg });
			}
		}
	} finally {
		try { await postJson(`${api}/Security/RecordLock/ReleaseLock`, lockBody, 15000, headers, opts.logFn); } catch (e) { /* lock expires with the session */ }
	}
	return { results };
}

export default { createCaseFlags, getCaseFlagColors, getCaseFlagConfigs };
