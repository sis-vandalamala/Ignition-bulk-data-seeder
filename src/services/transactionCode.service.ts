import { postJson, describeApiError, type ApiLogEntry } from '../utils/api';
import { apiRoot, jsonHeaders, useGranularBusinessRoutes, uniqueSuffix } from './businessConfig';

// TransactionType ids (SIS TransactionTypeEnum). "Charge" (1) is system-only and not offered.
export const TRANSACTION_TYPES: Record<string, number> = {
	'Payment': 2,
	'Unassigned Payment': 3,
	'Write-Off': 4,
	'Correction': 5,
	'Debit': 6,
	'Transfer': 7,
	'Allocation': 8,
};

function glRef(id?: string | number) {
	const n = Number(id);
	return id !== undefined && id !== '' && !Number.isNaN(n) && n > 0 ? { generalLedgerAccountId: n } : null;
}

export type CreateTransactionCodeOptions = {
	apiBaseUrl: string;
	token: string;
	transactionCodeName: string;
	granular: boolean;
	type?: string;
	toDebit?: string;
	toCredit?: string;
	timeoutMs?: number;
	extraHeaders?: Record<string, string>;
	logFn?: (entry: ApiLogEntry) => void;
};

export async function createTransactionCode(o: CreateTransactionCodeOptions) {
	const url = o.granular ? `${apiRoot(o.apiBaseUrl)}/facility/business/transaction-codes` : `${apiRoot(o.apiBaseUrl)}/TransactionCode/UpsertTransactionCode`;
	const typeId = o.type ? TRANSACTION_TYPES[o.type] : undefined;
	if (o.type && typeId === undefined) throw new Error(`Unknown transaction type "${o.type}" (expected one of: ${Object.keys(TRANSACTION_TYPES).join(', ')})`);
	// Same shape the SIS app saves (TransactionCode model); organizationId comes from the session
	const payload: Record<string, any> = {
		transactionCodeId: 0,
		transactionCodeName: o.transactionCodeName,
		transactionTypeId: typeId ?? null,
		transactionType: o.type ?? null,
		contractualAdjustmentTf: false,
		itemSource: 1,
		generalLedgerToDebit: glRef(o.toDebit),
		generalLedgerToCredit: glRef(o.toCredit),
	};
	try {
		return await postJson(url, payload, o.timeoutMs ?? 20000, jsonHeaders(o.token, o.extraHeaders), o.logFn);
	} catch (e) {
		throw new Error(`Save transaction code failed: ${describeApiError(e)}`);
	}
}

export type CreateTransactionCodesBatchOptions = Omit<CreateTransactionCodeOptions, 'transactionCodeName' | 'granular'> & {
	count?: number;
	mode?: 'auto' | 'manual';
};

export type TransactionCodeAttemptResult = {
	ok: boolean;
	index: number;
	transactionCodeName: string;
	transactionCodeId?: number;
	type?: string;
	data?: any;
	error?: string;
};

export async function createTransactionCodes(opts: CreateTransactionCodesBatchOptions): Promise<{ results: TransactionCodeAttemptResult[]; route: 'granular' | 'legacy' }> {
	if (!opts.apiBaseUrl) throw new Error('apiBaseUrl is required');
	if (!opts.token) throw new Error('Not logged in (no token)');
	const total = Math.max(1, Number(opts.count) || 1);
	const granular = await useGranularBusinessRoutes(opts.apiBaseUrl, opts.token, opts.logFn);
	const typeNames = Object.keys(TRANSACTION_TYPES);
	const results: TransactionCodeAttemptResult[] = [];
	for (let i = 1; i <= total; i += 1) {
		const transactionCodeName = `TXN ${uniqueSuffix()}`;
		// Auto mode: random type, no GL accounts
		const type = opts.mode === 'auto' ? typeNames[Math.floor(Math.random() * typeNames.length)] : (opts.type || 'Allocation');
		try {
			const data = await createTransactionCode({ ...opts, transactionCodeName, granular, type, toDebit: opts.mode === 'auto' ? undefined : opts.toDebit, toCredit: opts.mode === 'auto' ? undefined : opts.toCredit });
			results.push({ ok: true, index: i, transactionCodeName, type, transactionCodeId: data && data.transactionCodeId, data });
		} catch (err: any) {
			results.push({ ok: false, index: i, transactionCodeName, type, error: err && err.message ? err.message : String(err) });
		}
	}
	return { results, route: granular ? 'granular' : 'legacy' };
}

export default { createTransactionCode, createTransactionCodes };
