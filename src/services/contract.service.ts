import { putJson, deleteJson, postJson, formatErrorWithBody, type ApiLogEntry } from '../utils/api';

const CREATE_CONTRACT_ENDPOINT = '/api/facility/business/contracts';
const POSTING_OPTIONS_ENDPOINT = '/api/facility/business/contracts/posting-options';
const POSTING_OPTION_ENDPOINT = '/api/facility/business/contracts/posting-option';
const RECALCULATE_ENDPOINT = '/api/facility/business/contracts/review-list/recalculate';
const DEFAULT_ADJUSTMENT_TIME_ID = 16297;
const DEFAULT_ADJUSTMENT_TIME_STRING = 'At Charge Posting';

// Both '% of Billed Charges' and 'Contract Fee Schedule' post the same postingOption
// to this backend; 'Grouper' has no posting-option call at all.
const POSTING_OPTION_BY_CONTRACT_TYPE: Record<string, number> = {
	'% of Billed Charges': 1,
	'Contract Fee Schedule': 1,
};

function buildHeaders(token: string, extra?: Record<string, string>) {
	const base: Record<string, string> = {
		accept: 'application/json, text/plain, */*',
		'content-type': 'application/json;charset=UTF-8',
		token,
	};
	if (extra) {
		for (const k of Object.keys(extra)) base[k] = extra[k];
	}
	return base;
}

function generateUniqueContractName() {
	const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
	return `Contract ${Date.now()}${rand}`;
}

export type CreateContractOptions = {
	apiBaseUrl: string;
	token: string;
	contractName?: string;
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

export async function createContract({ apiBaseUrl, token, contractName, isHybridContract = false, contractType, pctBilledCharges, pctAllowed, effectiveDate, expiryDate, notes, timeoutMs = 15000, extraHeaders, logFn }: CreateContractOptions) {
	if (!apiBaseUrl) throw new Error('apiBaseUrl is required');
	if (!token) throw new Error('token is required');
	const base = String(apiBaseUrl).replace(/\/$/, '');
	const headers = buildHeaders(token, extraHeaders);
	const createPayload: Record<string, any> = {
		insuranceContractName: contractName || generateUniqueContractName(),
		insuranceContractId: 0,
		isHybridContract,
	};
	if (effectiveDate !== undefined) createPayload.effectiveDate = effectiveDate;
	if (expiryDate !== undefined) createPayload.expirationDate = expiryDate;
	if (notes !== undefined) createPayload.notes = notes;
	const created = await putJson(`${base}${CREATE_CONTRACT_ENDPOINT}`, createPayload, timeoutMs, headers, logFn);
	console.log('[contract.service] create response:', JSON.stringify(created));

	const postingOption = contractType !== undefined ? POSTING_OPTION_BY_CONTRACT_TYPE[contractType] : undefined;
	if (postingOption === undefined) return created;

	const insuranceContractId = created?.insuranceContractId ?? created?.insuranceContractObjectId ?? created?.id;
	console.log('[contract.service] extracted insuranceContractId:', insuranceContractId);
	try {
		const delResult = await deleteJson(`${base}${POSTING_OPTIONS_ENDPOINT}/${insuranceContractId}`, timeoutMs, headers, logFn);
		console.log('[contract.service] delete posting-options response:', JSON.stringify(delResult));
	} catch (e: any) {
		console.log('[contract.service] delete posting-options error (tolerated):', e && e.response ? formatErrorWithBody(e, e.response) : String(e));
	}

	const percentOfBilledCharge = pctBilledCharges !== undefined ? pctBilledCharges : pctAllowed;
	const postingOptionPayload: Record<string, any> = {
		postingOption,
		insuranceContractId,
		adjustmentTimeId: DEFAULT_ADJUSTMENT_TIME_ID,
		adjustmentTimeString: DEFAULT_ADJUSTMENT_TIME_STRING,
	};
	if (percentOfBilledCharge !== undefined) postingOptionPayload.percentOfBilledCharge = percentOfBilledCharge;
	console.log('[contract.service] posting-option request:', JSON.stringify(postingOptionPayload));
	const postingResult = await putJson(`${base}${POSTING_OPTION_ENDPOINT}`, postingOptionPayload, timeoutMs, headers, logFn);
	console.log('[contract.service] posting-option response:', JSON.stringify(postingResult));

	const recalcResult = await postJson(`${base}${RECALCULATE_ENDPOINT}`, { insuranceContractId, pageNumber: 1, rowsPerPage: 1, filterText: '' }, timeoutMs, headers, logFn);
	console.log('[contract.service] recalculate response:', JSON.stringify(recalcResult));

	return created;
}

export type CreateContractsBatchOptions = {
	apiBaseUrl: string;
	token: string;
	count?: number;
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

export type ContractAttemptResult = {
	ok: boolean;
	contractName: string;
	data?: any;
	error?: string;
};

export async function createContracts({ apiBaseUrl, token, count = 1, isHybridContract = false, contractType, pctBilledCharges, pctAllowed, effectiveDate, expiryDate, notes, timeoutMs, extraHeaders, logFn }: CreateContractsBatchOptions): Promise<ContractAttemptResult[]> {
	const total = Math.max(1, Number(count) || 1);
	const results: ContractAttemptResult[] = [];
	for (let i = 0; i < total; i += 1) {
		const contractName = generateUniqueContractName();
		try {
			const data = await createContract({ apiBaseUrl, token, contractName, isHybridContract, contractType, pctBilledCharges, pctAllowed, effectiveDate, expiryDate, notes, timeoutMs, extraHeaders, logFn });
			results.push({ ok: true, contractName, data });
		} catch (err: any) {
			const error = err && err.response ? formatErrorWithBody(err, err.response) : (err && err.message ? err.message : String(err));
			results.push({ ok: false, contractName, error });
		}
	}
	return results;
}

export default {
	createContract,
	createContracts,
};
