import { putJson, deleteJson, postJson, describeApiError, type ApiLogEntry } from '../utils/api';
import { apiRoot, jsonHeaders, useGranularBusinessRoutes, uniqueSuffix } from './businessConfig';

// Contract type ids used by InsuranceContract.contractType
export const CONTRACT_TYPE_IDS: Record<string, number> = {
	'Grouper': 1,
	'Contract Fee Schedule': 2,
	'% of Billed Charges': 3,
};
// '% of Billed Charges' and 'Contract Fee Schedule' both post postingOption 1; 'Grouper' has no posting option.
const POSTING_OPTION_BY_CONTRACT_TYPE: Record<string, number> = {
	'% of Billed Charges': 1,
	'Contract Fee Schedule': 1,
};
// Dictionary 169 "Adjustment Time" → "At Charge Posting"
const DEFAULT_ADJUSTMENT_TIME_ID = 16297;
const DEFAULT_ADJUSTMENT_TIME_STRING = 'At Charge Posting';

type Routes = {
	saveContract: string; // PUT
	deletePostingOptions: (id: number) => string; // DELETE
	savePostingOption: string; // PUT
	recalculate: string; // POST
};
function routes(apiBaseUrl: string, granular: boolean): Routes {
	const api = apiRoot(apiBaseUrl);
	if (granular) {
		const b = `${api}/facility/business/contracts`;
		return {
			saveContract: b,
			deletePostingOptions: (id) => `${b}/posting-options/${id}`,
			savePostingOption: `${b}/posting-option`,
			recalculate: `${b}/review-list/recalculate`,
		};
	}
	return {
		saveContract: `${api}/InsuranceContract/SaveInsuranceContract`,
		deletePostingOptions: (id) => `${api}/InsuranceContract/DeleteAllInsuranceContractOptions?insuranceContractId=${id}`,
		savePostingOption: `${api}/InsuranceContract/SaveInsuranceContractPostingOption`,
		recalculate: `${api}/InsuranceContract/RecalculateContractReviewListByContractId/`,
	};
}

function toIsoDate(d?: string) {
	if (!d) return undefined;
	return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d;
}

export type CreateContractOptions = {
	apiBaseUrl: string;
	token: string;
	contractName: string;
	granular: boolean;
	isHybridContract?: boolean;
	contractType?: string;
	pctBilledCharges?: number;
	pctAllowed?: number;
	effectiveDate?: string;
	expiryDate?: string;
	notes?: string;
	timeoutMs?: number;
	extraHeaders?: Record<string, string>;
	logFn?: (entry: ApiLogEntry) => void;
};

export async function createContract(o: CreateContractOptions) {
	const timeoutMs = o.timeoutMs ?? 20000;
	const headers = jsonHeaders(o.token, o.extraHeaders);
	const r = routes(o.apiBaseUrl, o.granular);
	const createPayload: Record<string, any> = {
		insuranceContractId: 0,
		insuranceContractName: o.contractName,
		isHybridContract: !!o.isHybridContract,
		itemSource: 1,
	};
	if (o.contractType && CONTRACT_TYPE_IDS[o.contractType] !== undefined) createPayload.contractType = CONTRACT_TYPE_IDS[o.contractType];
	if (o.effectiveDate) createPayload.effectiveDate = toIsoDate(o.effectiveDate);
	if (o.expiryDate) createPayload.expirationDate = toIsoDate(o.expiryDate);
	if (o.notes !== undefined && o.notes !== '') createPayload.notes = o.notes;

	let created: any;
	try {
		created = await putJson(r.saveContract, createPayload, timeoutMs, headers, o.logFn);
	} catch (e) {
		throw new Error(`Save contract failed: ${describeApiError(e)}`);
	}
	const insuranceContractId = created?.insuranceContractId ?? created?.insuranceContractObjectId ?? created?.id;
	if (!insuranceContractId) throw new Error(`Save contract returned no insuranceContractId (response: ${JSON.stringify(created).slice(0, 300)})`);

	const postingOption = o.contractType ? POSTING_OPTION_BY_CONTRACT_TYPE[o.contractType] : undefined;
	let postingResult: any;
	if (postingOption !== undefined) {
		// A brand-new contract has no posting options yet; the app clears them first anyway, so mirror it (tolerated).
		try { await deleteJson(r.deletePostingOptions(insuranceContractId), timeoutMs, headers, o.logFn); } catch (e) { /* none to delete */ }
		const pct = o.contractType === 'Contract Fee Schedule' ? (o.pctAllowed ?? o.pctBilledCharges) : (o.pctBilledCharges ?? o.pctAllowed);
		const postingPayload: Record<string, any> = {
			postingOption,
			insuranceContractId,
			adjustmentTimeId: DEFAULT_ADJUSTMENT_TIME_ID,
			adjustmentTimeString: DEFAULT_ADJUSTMENT_TIME_STRING,
		};
		if (pct !== undefined) postingPayload.percentOfBilledCharge = pct;
		try {
			postingResult = await putJson(r.savePostingOption, postingPayload, timeoutMs, headers, o.logFn);
		} catch (e) {
			throw new Error(`Contract ${insuranceContractId} created but saving its posting option failed: ${describeApiError(e)}`);
		}
		try {
			await postJson(r.recalculate, { insuranceContractId, pageNumber: 1, rowsPerPage: 1, filterText: '' }, timeoutMs, headers, o.logFn);
		} catch (e) {
			throw new Error(`Contract ${insuranceContractId} created but review-list recalculation failed: ${describeApiError(e)}`);
		}
	}
	return { contract: created, postingOption: postingResult };
}

export type CreateContractsBatchOptions = Omit<CreateContractOptions, 'contractName' | 'granular'> & {
	count?: number;
	mode?: 'auto' | 'manual';
	// live progress hooks (one call per item)
	onItemStart?: (index: number, stage: string) => void;
	onItemComplete?: (result: any) => void;
};

export type ContractAttemptResult = {
	ok: boolean;
	index: number;
	contractName: string;
	insuranceContractId?: number;
	contractType?: string;
	data?: any;
	error?: string;
};

export async function createContracts(opts: CreateContractsBatchOptions): Promise<{ results: ContractAttemptResult[]; route: 'granular' | 'legacy' }> {
	if (!opts.apiBaseUrl) throw new Error('apiBaseUrl is required');
	if (!opts.token) throw new Error('Not logged in (no token)');
	const total = Math.max(1, Number(opts.count) || 1);
	const granular = await useGranularBusinessRoutes(opts.apiBaseUrl, opts.token, opts.logFn);
	const isAuto = opts.mode === 'auto';
	const today = new Date();
	const ymd = (d: Date) => d.toISOString().slice(0, 10);
	const results: ContractAttemptResult[] = [];
	for (let i = 1; i <= total; i += 1) {
		const contractName = `Contract ${uniqueSuffix()}`;
		// Auto mode: % of Billed Charges, random 30-80%, effective today for one year
		const contractType = isAuto ? '% of Billed Charges' : (opts.contractType || '% of Billed Charges');
		const pctBilledCharges = isAuto ? 30 + Math.floor(Math.random() * 51) : opts.pctBilledCharges;
		const effectiveDate = isAuto ? ymd(today) : opts.effectiveDate;
		const expiryDate = isAuto ? ymd(new Date(Date.UTC(today.getUTCFullYear() + 1, today.getUTCMonth(), today.getUTCDate()))) : opts.expiryDate;
		try { opts.onItemStart?.(i, 'Saving contract'); } catch (e) {}
		try {
			const data = await createContract({ ...opts, contractName, granular, contractType, pctBilledCharges, effectiveDate, expiryDate, notes: isAuto ? 'Seeded by Ignition' : opts.notes });
			results.push({ ok: true, index: i, contractName, contractType, insuranceContractId: data.contract?.insuranceContractId, data });
		} catch (err: any) {
			results.push({ ok: false, index: i, contractName, contractType, error: err && err.message ? err.message : String(err) });
		}
		try { opts.onItemComplete?.(results[results.length - 1]); } catch (e) {}
	}
	return { results, route: granular ? 'granular' : 'legacy' };
}

export default { createContract, createContracts };
