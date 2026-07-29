import { putJson, type ApiLogEntry } from '../utils/api';

const CREATE_CONTRACT_ENDPOINT = '/api/facility/business/contracts';

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
	effectiveDate?: string;
	expiryDate?: string;
	notes?: string;
	timeoutMs?: number;
	extraHeaders?: Record<string, string>;
	logFn?: (entry: ApiLogEntry) => void;
};

export async function createContract({ apiBaseUrl, token, contractName, isHybridContract = false, contractType, pctBilledCharges, effectiveDate, expiryDate, notes, timeoutMs = 15000, extraHeaders, logFn }: CreateContractOptions) {
	if (!apiBaseUrl) throw new Error('apiBaseUrl is required');
	if (!token) throw new Error('token is required');
	const base = String(apiBaseUrl).replace(/\/$/, '');
	const url = `${base}${CREATE_CONTRACT_ENDPOINT}`;
	const headers = buildHeaders(token, extraHeaders);
	const payload: Record<string, any> = {
		insuranceContractName: contractName || generateUniqueContractName(),
		insuranceContractId: 0,
		isHybridContract,
	};
	if (contractType !== undefined) payload.contractType = contractType;
	if (pctBilledCharges !== undefined) payload.pctBilledCharges = pctBilledCharges;
	if (effectiveDate !== undefined) payload.effectiveDate = effectiveDate;
	if (expiryDate !== undefined) payload.expirationDate = expiryDate;
	if (notes !== undefined) payload.notes = notes;
	return putJson(url, payload, timeoutMs, headers, logFn);
}

export type CreateContractsBatchOptions = {
	apiBaseUrl: string;
	token: string;
	count?: number;
	isHybridContract?: boolean;
	contractType?: string;
	pctBilledCharges?: number;
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

export async function createContracts({ apiBaseUrl, token, count = 1, isHybridContract = false, contractType, pctBilledCharges, effectiveDate, expiryDate, notes, timeoutMs, extraHeaders, logFn }: CreateContractsBatchOptions): Promise<ContractAttemptResult[]> {
	const total = Math.max(1, Number(count) || 1);
	const results: ContractAttemptResult[] = [];
	for (let i = 0; i < total; i += 1) {
		const contractName = generateUniqueContractName();
		try {
			const data = await createContract({ apiBaseUrl, token, contractName, isHybridContract, contractType, pctBilledCharges, effectiveDate, expiryDate, notes, timeoutMs, extraHeaders, logFn });
			results.push({ ok: true, contractName, data });
		} catch (err: any) {
			results.push({ ok: false, contractName, error: err && err.message ? err.message : String(err) });
		}
	}
	return results;
}

export default {
	createContract,
	createContracts,
};
