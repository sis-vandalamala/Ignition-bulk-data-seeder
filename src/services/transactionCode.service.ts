import { postJson, type ApiLogEntry } from '../utils/api';

const CREATE_TRANSACTION_CODE_ENDPOINT = '/api/facility/business/transaction-codes';

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

function generateUniqueTransactionCodeName() {
	const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
	return `TXN ${Date.now()}${rand}`;
}

export type CreateTransactionCodeOptions = {
	apiBaseUrl: string;
	token: string;
	transactionCodeName?: string;
	type?: string;
	toDebit?: string;
	toCredit?: string;
	timeoutMs?: number;
	extraHeaders?: Record<string, string>;
	logFn?: (entry: ApiLogEntry) => void;
};

export async function createTransactionCode({ apiBaseUrl, token, transactionCodeName, type, toDebit, toCredit, timeoutMs = 15000, extraHeaders, logFn }: CreateTransactionCodeOptions) {
	if (!apiBaseUrl) throw new Error('apiBaseUrl is required');
	if (!token) throw new Error('token is required');
	const base = String(apiBaseUrl).replace(/\/$/, '');
	const url = `${base}${CREATE_TRANSACTION_CODE_ENDPOINT}`;
	const headers = buildHeaders(token, extraHeaders);
	const payload: Record<string, any> = {
		transactionCodeName: transactionCodeName || generateUniqueTransactionCodeName(),
	};
	if (type !== undefined) payload.type = type;
	if (toDebit !== undefined) payload.toDebit = toDebit;
	if (toCredit !== undefined) payload.toCredit = toCredit;
	return postJson(url, payload, timeoutMs, headers, logFn);
}

export type CreateTransactionCodesBatchOptions = {
	apiBaseUrl: string;
	token: string;
	count?: number;
	type?: string;
	toDebit?: string;
	toCredit?: string;
	timeoutMs?: number;
	extraHeaders?: Record<string, string>;
	logFn?: (entry: ApiLogEntry) => void;
};

export type TransactionCodeAttemptResult = {
	ok: boolean;
	transactionCodeName: string;
	data?: any;
	error?: string;
};

export async function createTransactionCodes({ apiBaseUrl, token, count = 1, type, toDebit, toCredit, timeoutMs, extraHeaders, logFn }: CreateTransactionCodesBatchOptions): Promise<TransactionCodeAttemptResult[]> {
	const total = Math.max(1, Number(count) || 1);
	const results: TransactionCodeAttemptResult[] = [];
	for (let i = 0; i < total; i += 1) {
		const transactionCodeName = generateUniqueTransactionCodeName();
		try {
			const data = await createTransactionCode({ apiBaseUrl, token, transactionCodeName, type, toDebit, toCredit, timeoutMs, extraHeaders, logFn });
			results.push({ ok: true, transactionCodeName, data });
		} catch (err: any) {
			results.push({ ok: false, transactionCodeName, error: err && err.message ? err.message : String(err) });
		}
	}
	return results;
}

export default {
	createTransactionCode,
	createTransactionCodes,
};
