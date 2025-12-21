import fs from 'fs';
import path from 'path';

import axios from 'axios';
import { postJson, getJson, ApiLogEntry } from '../utils/api';
import createCaseSummary from './caseSummary.service';
import { requestRecordLock, releaseRecordLock, getPeriodBatches, createPeriod, createBatch, getRoomsForOrganization } from './support.service';
import { runDischargeFlow } from './discharge.service';
import codingChargeEntry, { type ChargeEntryPeriodBatch } from './codingChargeEntry.service';
import { insertInsuranceGemini, createInsertInsurancePayload, type InsuranceInsertOverrides, type CreateInsuranceResult } from './insurance.service';
import type { IGetDuplicatePatient } from '../models/getDuplicatePatients.interface';

// module loaded (no debug log)

const duplicatePatientTemplatePath = path.join(__dirname, '..', 'reqTemplates', 'getDuplicatePatients.req.json');
const createPatientTemplatePath = path.join(__dirname, '..', 'reqTemplates', 'createPatient.req.json');
let duplicatePatientTemplate: IGetDuplicatePatient | null = null;
let createPatientTemplate: any | null = null;

const AUTO_FIRST_NAMES = [
	'Avery', 'Atlas', 'Beck', 'Calla', 'Dorian', 'Elowen', 'Finn', 'Galen', 'Harbor', 'Indigo', 'Junia', 'Kai', 'Lennox', 'Mira', 'Nash', 'Opal', 'Pax', 'Quinn', 'Rowan', 'Sage', 'Thalia', 'Vera', 'Wyatt', 'Xander', 'Yara', 'Zane'
];

const AUTO_LAST_NAMES = [
	'Alder', 'Briar', 'Calder', 'Dalton', 'Ellis', 'Fletcher', 'Grady', 'Hayes', 'Iverson', 'Jensen', 'Keaton', 'Larkin', 'Mercer', 'North', 'Orwell', 'Prescott', 'Quill', 'Ridley', 'Sterling', 'Tate', 'Ulrich', 'Vance', 'Whitley', 'York', 'Zeller'
];

const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

type PeriodBatchMode = 'select' | 'create' | 'auto';
type PeriodBatchContext = ChargeEntryPeriodBatch;

function sanitizeSuffix(raw?: string | null) {
	if (!raw) return '';
	return raw.replace(/[^0-9a-zA-Z_-]/g, '').trim();
}

function randomAutoSuffix() {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	let out = '';
	for (let i = 0; i < 6; i += 1) {
		out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	}
	return out || 'AUTO';
}

function iso(date: Date) {
	return date.toISOString();
}

function startOfMonthUtc(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonthUtc(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function baseDateFromDos(dos?: string) {
	if (!dos) return new Date();
	const parsed = new Date(dos);
	return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function startOfDayUtc(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function formatHHmm(d: Date) {
	const hh = String(d.getUTCHours()).padStart(2, '0');
	const mm = String(d.getUTCMinutes()).padStart(2, '0');
	return `${hh}:${mm}`;
}

function extractRoomId(room: any): number | undefined {
	const candidates = [room?.roomId, room?.RoomId, room?.roomID, room?.id, room?.value];
	for (const c of candidates) {
		const n = Number(c);
		if (!Number.isNaN(n) && n > 0) return n;
	}
	return undefined;
}

function extractRoomName(room: any): string | undefined {
	const candidates = [room?.name, room?.roomName, room?.RoomName, room?.displayName, room?.label];
	for (const c of candidates) {
		if (typeof c === 'string' && c.trim()) return c.trim();
	}
	return undefined;
}

function pickRandomRoom(rooms: any[]): { roomId?: number; roomName?: string } {
	if (!Array.isArray(rooms) || rooms.length === 0) return {};
	const idx = Math.floor(Math.random() * rooms.length);
	const chosen = rooms[idx];
	return { roomId: extractRoomId(chosen), roomName: extractRoomName(chosen) };
}

function generateRandom15MinSlot(dos?: string) {
	const base = startOfDayUtc(baseDateFromDos(dos));
	// Auto window: choose start in [02:30 .. 20:45] so end is ≤ 21:00
	// Slot indices: 00:00 = 0; 02:30 = 150/15 = 10; 20:45 = 1245/15 = 83
	const minStartSlot = 10; // 02:30
	const maxStartSlot = 70; // 20:45 (end 21:00)
	const startSlot = minStartSlot + Math.floor(Math.random() * (maxStartSlot - minStartSlot + 1));
	const startMinutes = startSlot * 15;
	const endMinutes = startMinutes + 15;
	const start = new Date(base.getTime() + startMinutes * 60000);
	const end = new Date(base.getTime() + endMinutes * 60000);
	const mmddyyyy = `${String(base.getUTCMonth() + 1).padStart(2, '0')}/${String(base.getUTCDate()).padStart(2, '0')}/${String(base.getUTCFullYear())}`;
	return {
		duration: 15,
		startIso: start.toISOString(),
		endIso: end.toISOString(),
		startHHmm: formatHHmm(start),
		endHHmm: formatHHmm(end),
		dosText: mmddyyyy,
		baseStartIso: start.toISOString(),
	};
}

function firstValidNumber(values: Array<any>) {
	for (const value of values) {
		const num = Number(value);
		if (!Number.isNaN(num) && num > 0) return num;
	}
	return undefined;
}

function firstNonEmptyString(values: Array<any>) {
	for (const value of values) {
		if (typeof value !== 'string') continue;
		const trimmed = value.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

function sameText(a?: string | null, b?: string | null) {
	if (typeof a !== 'string' || typeof b !== 'string') return false;
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function responseCandidates(input: any): any[] {
	const out: any[] = [];
	const stack: any[] = [input];
	while (stack.length) {
		const current = stack.pop();
		if (current === null || typeof current === 'undefined') continue;
		if (typeof current === 'string') {
			const trimmed = current.trim();
			if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
				try { stack.push(JSON.parse(trimmed)); } catch (e) {}
			}
			continue;
		}
		if (Array.isArray(current)) {
			for (const item of current) stack.push(item);
			continue;
		}
		out.push(current);
		if (current.result) stack.push(current.result);
		if (current.Results) stack.push(current.Results);
		if (current.data) stack.push(current.data);
		if (current.period) stack.push(current.period);
		if (current.batch) stack.push(current.batch);
	}
	return out;
}

function extractPeriodIdFromResponse(res: any): number | undefined {
	const candidates = responseCandidates(res);
	for (const candidate of candidates) {
		const val = firstValidNumber([
			candidate?.periodId,
			candidate?.PeriodId,
			candidate?.id,
			candidate?.value,
			candidate?.result?.periodId,
			candidate?.result?.id,
			candidate?.result?.value,
			candidate?.result?.period?.periodId,
			candidate?.period?.periodId,
		]);
		if (val) return val;
	}
	return undefined;
}

function extractBatchIdFromResponse(res: any): number | undefined {
	const candidates = responseCandidates(res);
	for (const candidate of candidates) {
		const val = firstValidNumber([
			candidate?.batchId,
			candidate?.BatchId,
			candidate?.id,
			candidate?.value,
			candidate?.result?.batchId,
			candidate?.result?.id,
			candidate?.batch?.batchId,
		]);
		if (val) return val;
	}
	return undefined;
}

function asPeriodCollection(data: any): any[] {
	if (Array.isArray(data)) return data;
	if (Array.isArray(data?.result)) return data.result;
	if (Array.isArray(data?.periods)) return data.periods;
	return [];
}

function buildPeriodPayload(periodName: string, facilityId?: number, dos?: string, username?: string) {
	const now = new Date();
	const rangeBase = baseDateFromDos(dos);
	const begin = startOfMonthUtc(rangeBase);
	const end = endOfMonthUtc(rangeBase);
	return {
		periodId: 0,
		organizationId: facilityId ?? null,
		periodName,
		periodCreatedDate: iso(now),
		periodClosedDate: null,
		periodCreatorUsrId: 0,
		openedBy: username || 'Ignition Seeder',
		closedBy: null,
		periodCloserUsrId: null,
		periodBeginDate: iso(begin),
		periodEndDate: iso(end),
		isReadOnlyPeriodBatch: false,
		resetClosedPeriodBatch: false,
		moduleId: 2030,
		sourceIdentifier: ZERO_GUID,
	};
}

function buildBatchPayload(periodId: number, batchDescription: string, dos?: string) {
	const now = new Date();
	const rangeBase = baseDateFromDos(dos);
	const begin = startOfMonthUtc(rangeBase);
	const end = endOfMonthUtc(rangeBase);
	return {
		batchId: 0,
		periodId,
		batchDescription,
		batchCreatedDate: iso(now),
		batchClosedDate: null,
		batchCreatorUsrId: 0,
		batchCloserUsrId: null,
		batchBeginDate: iso(begin),
		batchEndDate: iso(end),
		isActive: true,
		openCases: 0,
		sourceIdentifier: ZERO_GUID,
	};
}

async function resolveSelectedPeriodBatch(opts: CreateBasicPatientsOptions, token: string): Promise<PeriodBatchContext> {
	const periodId = firstValidNumber([opts.selectedPeriodId]);
	const batchId = firstValidNumber([opts.selectedBatchId]);
	if (!periodId || !batchId) throw new Error('Period and batch selection are required when using existing values.');
	const response = await getPeriodBatches(token, opts.apiBaseUrl, opts.extraHeaders);
	const periods = Array.isArray(response) ? response : [];
	const matchById = (val: any, target: number) => {
		const found = firstValidNumber([val?.periodId, val?.PeriodId, val?.id, val?.value, val?.periodId]);
		return typeof found === 'number' && found === target;
	};
	const matchBatchById = (val: any, target: number) => {
		const found = firstValidNumber([val?.batchId, val?.BatchId, val?.id, val?.value]);
		return typeof found === 'number' && found === target;
	};
	const period = periods.find((p: any) => matchById(p, periodId));
	if (!period) throw new Error(`Selected period (${periodId}) was not found on the API.`);
	let batch: any = null;
	if (Array.isArray(period.batches)) {
		batch = period.batches.find((b: any) => matchBatchById(b, batchId));
	}
	if (!batch) {
		const flat = periods.flatMap((p: any) => (Array.isArray(p.batches) ? p.batches : []));
		batch = flat.find((b: any) => matchBatchById(b, batchId) && matchById({ periodId: b?.periodId ?? b?.PeriodId }, periodId))
			|| flat.find((b: any) => matchBatchById(b, batchId));
	}
	if (!batch) throw new Error(`Selected batch (${batchId}) was not found on the API.`);
	return {
		periodId,
		periodName: String(period.label ?? period.periodName ?? `Period${periodId}`),
		batchId,
		batchDescription: String(batch.batchDescription ?? batch.label ?? `Batch${batchId}`),
	};
}

async function createNewPeriodBatch(opts: CreateBasicPatientsOptions, token: string, periodName: string, batchName: string): Promise<PeriodBatchContext> {
	const periodPayload = buildPeriodPayload(periodName, opts.facilityId, opts.dos, opts.username);
	const periodRes = await createPeriod(token, opts.apiBaseUrl, periodPayload, opts.extraHeaders);
	let periodId = extractPeriodIdFromResponse(periodRes);
	if (!periodId) {
		const refreshed = asPeriodCollection(await getPeriodBatches(token, opts.apiBaseUrl, opts.extraHeaders));
		const match = refreshed.find((p: any) => sameText(p?.periodName ?? p?.label, periodName));
		periodId = firstValidNumber([match?.periodId, match?.PeriodId, match?.id, match?.value]);
	}
	if (!periodId) throw new Error('createPeriod response did not include a valid periodId.');
	const batchPayload = buildBatchPayload(periodId, batchName, opts.dos);
	const batchRes = await createBatch(token, opts.apiBaseUrl, batchPayload, opts.extraHeaders);
	let batchId = extractBatchIdFromResponse(batchRes);
	if (!batchId) {
		const refreshedAgain = asPeriodCollection(await getPeriodBatches(token, opts.apiBaseUrl, opts.extraHeaders));
		const parent = refreshedAgain.find((p: any) => {
			const pid = firstValidNumber([p?.periodId, p?.PeriodId, p?.id, p?.value]);
			return pid === periodId || sameText(p?.periodName ?? p?.label, periodName);
		});
		const batches = parent && Array.isArray(parent.batches) ? parent.batches : [];
		const matchBatch = batches.find((b: any) => sameText(b?.batchDescription ?? b?.label, batchName));
		batchId = firstValidNumber([matchBatch?.batchId, matchBatch?.BatchId, matchBatch?.id, matchBatch?.value]);
	}
	if (!batchId) throw new Error('createBatch response did not include a valid batchId.');
	return {
		periodId,
		periodName,
		batchId,
		batchDescription: batchName,
	};
}

async function resolvePeriodBatchContext(opts: CreateBasicPatientsOptions, token: string): Promise<PeriodBatchContext> {
	const selectionMode: PeriodBatchMode = opts.mode === 'auto'
		? 'auto'
		: (opts.periodBatchMode === 'create' ? 'create' : 'select');
	if (selectionMode === 'select') {
		return resolveSelectedPeriodBatch(opts, token);
	}
	const suffix = selectionMode === 'auto' ? randomAutoSuffix() : sanitizeSuffix(opts.suffix);
	if (!suffix) throw new Error('Suffix is required to create a new period and batch.');
	const periodName = `Period${suffix}`;
	const batchName = `Batch${suffix}`;
	return createNewPeriodBatch(opts, token, periodName, batchName);
}

type GeneratedName = { firstName: string; lastName: string };

function createAutoNameFactory() {
	const used = new Set<string>();
	const randomFrom = (list: string[]) => list[Math.floor(Math.random() * list.length)] ?? 'Auto';
	return (index: number): GeneratedName => {
		let first = randomFrom(AUTO_FIRST_NAMES);
		let last = randomFrom(AUTO_LAST_NAMES);
		let attempts = 0;
		while (used.has(`${first}|${last}`) && attempts < 40) {
			first = randomFrom(AUTO_FIRST_NAMES);
			last = randomFrom(AUTO_LAST_NAMES);
			attempts += 1;
		}
		if (used.has(`${first}|${last}`)) {
			const uniqueTag = `${index}${Math.random().toString(36).slice(2, 6)}`;
			first = `${first}${uniqueTag}`;
			last = `${last}${uniqueTag}`;
		}
		used.add(`${first}|${last}`);
		return { firstName: first, lastName: last };
	};
}

function loadTemplate(): IGetDuplicatePatient {
	if (duplicatePatientTemplate) return duplicatePatientTemplate;
	try {
		const raw = fs.readFileSync(duplicatePatientTemplatePath, 'utf8');
		duplicatePatientTemplate = JSON.parse(raw) as IGetDuplicatePatient;
	} catch (err) {
		throw new Error(`Failed to load getDuplicatePatients template: ${err}`);
	}
	return duplicatePatientTemplate!;
}

function loadCreatePatientTemplate() {
	if (createPatientTemplate) return createPatientTemplate;
	try {
		const raw = fs.readFileSync(createPatientTemplatePath, 'utf8');
		createPatientTemplate = JSON.parse(raw);
	} catch (err) {
		throw new Error(`Failed to load createPatient template: ${err}`);
	}
	return createPatientTemplate!;
}

function applyPatientDataToCreatePayload(payload: any, source: any) {
	if (!source || typeof source !== 'object') return payload;
	const assignIf = (key: string) => {
		if (key === 'gender') {
			const gv = source[key];
			if (typeof gv === 'string' && gv.trim() !== '') payload[key] = gv; // only overwrite if non-empty string
			return;
		}
		if (source[key] !== undefined && source[key] !== null) payload[key] = source[key];
	};
	['patientId', 'firstName', 'lastName', 'gender', 'primaryAccountNumber', 'fullName', 'fullNameWithTitle', 'fullNameWithTitlePrefixAsLastName', 'externalId', 'sourceIdentifier'].forEach(assignIf);
	if (Array.isArray(payload.accountNumbers)) {
		const srcAccounts = Array.isArray(source.accountNumbers) ? source.accountNumbers : [];
		payload.accountNumbers = payload.accountNumbers.map((entry: any, idx: number) => {
			const srcAcc = srcAccounts[idx] || srcAccounts[0];
			return Object.assign({}, entry, {
				patientId: source.patientId ?? entry?.patientId,
				organizationId: srcAcc && srcAcc.organizationId !== undefined ? srcAcc.organizationId : entry?.organizationId,
				accountNumber: srcAcc && srcAcc.accountNumber !== undefined ? srcAcc.accountNumber : (source.primaryAccountNumber ?? entry?.accountNumber),
				alias: srcAcc && srcAcc.alias !== undefined ? srcAcc.alias : entry?.alias,
				isPrimary: srcAcc && srcAcc.isPrimary !== undefined ? srcAcc.isPrimary : entry?.isPrimary,
				sortOrder: srcAcc && srcAcc.sortOrder !== undefined ? srcAcc.sortOrder : entry?.sortOrder,
				sourceIdentifier: srcAcc && srcAcc.sourceIdentifier !== undefined ? srcAcc.sourceIdentifier : entry?.sourceIdentifier,
			});
		});
	} else if (Array.isArray(source.accountNumbers)) {
		payload.accountNumbers = source.accountNumbers.map((acc: any) => ({
			patientId: acc.patientId ?? source.patientId ?? null,
			organizationId: acc.organizationId ?? null,
			accountNumber: acc.accountNumber ?? source.primaryAccountNumber ?? null,
			alias: acc.alias ?? null,
			isPrimary: acc.isPrimary ?? true,
			sortOrder: acc.sortOrder ?? 0,
			sourceIdentifier: acc.sourceIdentifier ?? null,
			externalCaseRequestId: acc.externalCaseRequestId ?? null,
		}));
	}
	if (payload?.mpiPatientPhone) payload.mpiPatientPhone.patientId = source.patientId ?? payload.mpiPatientPhone.patientId;
	if (payload?.mpiPatientPhoneSecondary) payload.mpiPatientPhoneSecondary.patientId = source.patientId ?? payload.mpiPatientPhoneSecondary.patientId;
	return payload;
}

export type CreateBasicPatientsOptions = {
	apiBaseUrl: string; // e.g. https://host/env
	token: string;
	suffix?: string;
	count: number;
	concurrency?: number;
	facilityId?: number;
	roomIdOverride?: number;
	roomNameOverride?: string;
	appointmentTypeIdOverride?: number;
	appointmentTypeNameOverride?: string;
	physicianIdOverride?: number;
	physicianNameOverride?: string;
	feeScheduleOverride?: any; // FeeSchedule object to map CPT dynamically
	cptAmounts?: Record<string, number>;
	dos?: string; // optional ISO date string for Date of Service
	logFn?: (entry: ApiLogEntry) => void;
	username?: string;
	extraHeaders?: Record<string, string>;
    flowDepth?: number; // 0 create only,1 discharge,2 cases-to-code,3 charge entry
	mode?: 'manual' | 'auto';
	periodBatchMode?: PeriodBatchMode;
	selectedPeriodId?: number;
	selectedBatchId?: number;
	insuranceInsertOverrides?: InsuranceInsertOverrides;
	// Support multiple insurance overrides (primary/secondary/tertiary)
	insuranceInsertOverridesList?: InsuranceInsertOverrides[];
	insertInsuranceTimeoutMs?: number;
	insuranceType?: string;
	insuranceCreateResult?: CreateInsuranceResult; // backward-compatible single
	// Multiple created insurance results (for plans/claim office mapping)
	insuranceCreateResults?: CreateInsuranceResult[];
};

export type CreateBasicPatientResult = {
	index: number;
	request: IGetDuplicatePatient;
	response?: any;
	fullPatient?: any;
	createPatientResponse?: any;
	caseSummaryResponse?: any;
	insertInsuranceResponse?: any; // backward-compatible single
	insertInsuranceResponses?: any[]; // preferred multiple
	insertInsuranceError?: string;
	error?: string;
};

export async function getPatient(apiBaseUrl: string, patientId: number, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = String(apiBaseUrl).replace(/\/$/, '');
	const url = `${base}/api/PatientData/Gemini/GetPatient/${patientId}`;
	const headers: Record<string, string> = { token, Accept: 'text/json' } as any;
	return await getJson(url, 20000, headers, logFn);
}




export async function createPatient(apiBaseUrl: string, token: string, patientPayload: any, logFn?: (entry: ApiLogEntry) => void, extraHeaders?: Record<string, string>) {
	const base = String(apiBaseUrl).replace(/\/$/, '');
	const url = `${base}/api/PatientData/Gemini/CreatePatient/2030`;
	const template = loadCreatePatientTemplate();
	const payload = JSON.parse(JSON.stringify(template));
	applyPatientDataToCreatePayload(payload, patientPayload);
	// default headers mimic a JSON API; allow caller to provide extra headers to mimic the UI
	const headers: Record<string, string> = Object.assign({
		'Content-Type': 'text/json',
		Accept: 'text/json',
		token,
	}, extraHeaders || {});

	// Use axios directly for detailed debugging (status, headers, raw body)
	try {
		// suppressed debug payload log
		const res = await axios.post(url, payload, {
			headers,
			timeout: 30000,
			responseType: 'text',
			transformResponse: [(data) => data],
		});
		let parsedResponse: any = null;
		try {
			parsedResponse = res.data ? JSON.parse(res.data) : null;
		} catch (parseErr) {
			
		}
		// suppressed response log
		return { request: payload, response: parsedResponse ?? res.data };
		} catch (err: any) {
			// rethrow
			throw err;
		}
}

export async function createBasicPatients(opts: CreateBasicPatientsOptions) {
	const { apiBaseUrl, token, suffix, count, concurrency, facilityId, logFn, mode } = opts;
	if (!apiBaseUrl) return { ok: false, error: 'apiBaseUrl is required' };
	if (!token) return { ok: false, error: 'token is required' };
	const suffixValue = typeof suffix === 'string' ? suffix : '';
	const isAutoMode = mode === 'auto';
	// In AUTO MODE, DOS should always be today (YYYY-MM-DD)
	if (isAutoMode) {
		try {
			const now = new Date();
			const yyyy = now.getUTCFullYear();
			const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
			const dd = String(now.getUTCDate()).padStart(2, '0');
			const todayYmd = `${yyyy}-${mm}-${dd}`;
			opts.dos = todayYmd;
		} catch (e) {
			// fallback: leave opts.dos as-is
		}
	}
	if (!suffixValue && !isAutoMode) return { ok: false, error: 'suffix is required' };
	const flowDepthValue = typeof opts.flowDepth === 'number' ? opts.flowDepth : 3;
	let periodBatchOverride: PeriodBatchContext | undefined;
	if (flowDepthValue >= 3) {
		periodBatchOverride = await resolvePeriodBatchContext(opts, token);
	}
	const total = Number(count) || 1;
	const maxConcurrency = Math.max(1, Math.min(Number(concurrency) || 8, 25));
	const base = String(apiBaseUrl).replace(/\/$/, '');
	const url = `${base}/api/PatientData/GetDuplicatePatients`;
	const headers: Record<string, string> = {
		'Content-Type': 'text/json',
		Accept: 'text/json',
		token,
	};
	const insertInsuranceTimeout = typeof opts.insertInsuranceTimeoutMs === 'number' ? opts.insertInsuranceTimeoutMs : 15000;

	const tpl = loadTemplate();
	// Preload rooms for AUTO MODE
	let roomsList: any[] = [];
	if (isAutoMode) {
		try {
			const rr: any = await getRoomsForOrganization(token, apiBaseUrl);
			roomsList = Array.isArray(rr) ? rr : (Array.isArray(rr?.rooms) ? rr.rooms : []);
		} catch (e) {
			roomsList = [];
		}
	}
	const pickAutoName = isAutoMode ? createAutoNameFactory() : null;
	const outcomes: Array<CreateBasicPatientResult | undefined> = new Array(total);
	let lastPatientId: number | null = null;

	const makeRequest = async (index: number) => {
		const autoName = isAutoMode && pickAutoName ? pickAutoName(index) : null;
		const request: IGetDuplicatePatient = {
			...tpl,
			firstName: autoName ? autoName.firstName : `InPFname${suffixValue}v${index}`,
			lastName: autoName ? autoName.lastName : `InPLname${suffixValue}v${index}`,
		};
		try {
			const response = await postJson(url, request, 20000, headers, logFn);
			// Log DuplicatePatient API response concisely
			try { /* DuplicatePatient response logged in outcomes */ } catch (e) {}
			// API always returns an array; take patientId from first element for this response
			let thisPid: number | null = null;
			try {
				if (Array.isArray(response) && response.length && response[0] && response[0].patientId) {
					const pid = Number(response[0].patientId);
					if (!Number.isNaN(pid) && pid !== 0) {
						thisPid = pid;
						lastPatientId = pid; // still track as last seen
					}
				}
			} catch (e) {}
			outcomes[index - 1] = { index, request, response };
			// if we have a patientId for this response, fetch its full patient and attach
			if (thisPid) {
				try {
					const full = await getPatient(apiBaseUrl, thisPid, token, logFn);
					outcomes[index - 1] = { index, request, response, fullPatient: full } as any;
					let insertInsuranceResponse: any = undefined;
					let insertInsuranceResponses: any[] | undefined = undefined;
					let insertInsuranceError: string | undefined;
					try {
								// Request a record lock for this patient before creating
								let lockRes: any = null;
								try {
									lockRes = await requestRecordLock(thisPid, token, apiBaseUrl);
									// suppressed requestRecordLock log
								} catch (e) {
									outcomes[index - 1] = { index, request, response, fullPatient: full, error: `recordLock failed: ${String(e)}` } as any;
									return;
								}
								if (lockRes && lockRes.error) {
									outcomes[index - 1] = { index, request, response, fullPatient: full, createPatientResponse: { lock: lockRes }, error: `recordLock returned error` } as any;
									return;
								}
								// call CreatePatient and capture request+response
								const created = await createPatient(apiBaseUrl, token, full, logFn, opts.extraHeaders);
						// Log CreatePatient API response (or fallback object)
						try { /* CreatePatient response captured in outcomes */ } catch (e) {}
						outcomes[index - 1] = { index, request, response, fullPatient: full, createPatientResponse: created } as any;
						try {
							// Prefer the API response if present; otherwise prefer the authoritative full GetPatient object;
							// finally fall back to the request payload we sent.
							let patientSource = (created && created.response != null)
								? created.response
								: (full ?? (created && created.request ? created.request : full));
							// If gender is missing on the authoritative source but was present on the request we sent, use it
							try {
								const srcGender = created && created.request && (created.request as any).gender ? (created.request as any).gender : null;
								if (srcGender && patientSource && (!patientSource.gender || (typeof patientSource.gender === 'string' && patientSource.gender.trim() === ''))) {
									(patientSource as any).gender = srcGender;
								}
							} catch (e) {}
					if (Array.isArray(opts.insuranceInsertOverridesList) && opts.insuranceInsertOverridesList.length) {
						try {
							insertInsuranceResponses = [];
							const patientIdForInsert = firstValidNumber([
								patientSource && patientSource.patientId,
								created && created.response ? (created.response as any).patientId : undefined,
								created && created.request ? (created.request as any).patientId : undefined,
								full ? (full as any).patientId : undefined,
								thisPid,
							]);
							if (!patientIdForInsert) {
								insertInsuranceError = 'Missing patientId for insertInsuranceGemini payload';
							} else {
								const patientFirstName = firstNonEmptyString([
									patientSource && patientSource.firstName,
									created && created.response ? (created.response as any).firstName : undefined,
									created && created.request ? (created.request as any).firstName : undefined,
									full ? (full as any).firstName : undefined,
									request.firstName,
								]);
								const patientLastName = firstNonEmptyString([
									patientSource && patientSource.lastName,
									created && created.response ? (created.response as any).lastName : undefined,
									created && created.request ? (created.request as any).lastName : undefined,
									full ? (full as any).lastName : undefined,
									request.lastName,
								]);
								for (const ov of opts.insuranceInsertOverridesList) {
									const payload = createInsertInsurancePayload({
										...(ov ?? {}),
										patientId: patientIdForInsert,
										firstName: patientFirstName ?? request.firstName,
										lastName: patientLastName ?? request.lastName,
									});
									const resp = await insertInsuranceGemini({
										apiBaseUrl,
										token,
										payload,
										timeoutMs: insertInsuranceTimeout,
										extraHeaders: opts.extraHeaders,
										logFn,
									});
									insertInsuranceResponses.push(resp);
								}
							}
						} catch (insertErr) {
							insertInsuranceError = insertErr && (insertErr as any).message ? (insertErr as any).message : String(insertErr);
						}
					} else if (opts.insuranceInsertOverrides) {
						try {
							const patientIdForInsert = firstValidNumber([
								patientSource && patientSource.patientId,
								created && created.response ? (created.response as any).patientId : undefined,
								created && created.request ? (created.request as any).patientId : undefined,
								full ? (full as any).patientId : undefined,
								thisPid,
							]);
							if (!patientIdForInsert) {
								insertInsuranceError = 'Missing patientId for insertInsuranceGemini payload';
							} else {
								const patientFirstName = firstNonEmptyString([
									patientSource && patientSource.firstName,
									created && created.response ? (created.response as any).firstName : undefined,
									created && created.request ? (created.request as any).firstName : undefined,
									full ? (full as any).firstName : undefined,
									request.firstName,
								]);
								const patientLastName = firstNonEmptyString([
									patientSource && patientSource.lastName,
									created && created.response ? (created.response as any).lastName : undefined,
									created && created.request ? (created.request as any).lastName : undefined,
									full ? (full as any).lastName : undefined,
									request.lastName,
								]);
								const payload = createInsertInsurancePayload({
									...(opts.insuranceInsertOverrides ?? {}),
									patientId: patientIdForInsert,
									firstName: patientFirstName ?? request.firstName,
									lastName: patientLastName ?? request.lastName,
								});
								insertInsuranceResponse = await insertInsuranceGemini({
									apiBaseUrl,
									token,
									payload,
									timeoutMs: insertInsuranceTimeout,
									extraHeaders: opts.extraHeaders,
									logFn,
								});
							}
						} catch (insertErr) {
							insertInsuranceError = insertErr && (insertErr as any).message ? (insertErr as any).message : String(insertErr);
						}
					}
							// Auto overrides: room + randomized 15-min slot across the day
							const autoTime = isAutoMode ? generateRandom15MinSlot(opts.dos) : null;
							const autoRoom = isAutoMode ? pickRandomRoom(roomsList) : {};
							const cs = await createCaseSummary({
								apiBaseUrl,
								token,
								patientResponse: patientSource,
								roomIdOverride: (patientSource && (patientSource.roomId || patientSource.roomId === 0)) ? (patientSource.roomId as number) : (isAutoMode && autoRoom.roomId !== undefined ? autoRoom.roomId : (opts.roomIdOverride === undefined ? undefined : opts.roomIdOverride)),
								roomNameOverride: (patientSource && (patientSource as any).roomName) ? (patientSource as any).roomName as string : (isAutoMode && autoRoom.roomName ? autoRoom.roomName : (opts.roomNameOverride === undefined ? undefined : opts.roomNameOverride)),
								appointmentTypeIdOverride: (patientSource && (patientSource.appointmentTypeId || patientSource.appointmentTypeId === 0)) ? (patientSource.appointmentTypeId as number) : (opts.appointmentTypeIdOverride === undefined ? undefined : opts.appointmentTypeIdOverride),
								appointmentTypeNameOverride: (patientSource && patientSource.appointmentTypeName) ? (patientSource.appointmentTypeName as string) : (opts.appointmentTypeNameOverride === undefined ? undefined : opts.appointmentTypeNameOverride),
								physicianIdOverride: (patientSource && (patientSource.primaryPhysicianId || patientSource.primaryPhysicianId === 0)) ? (patientSource.primaryPhysicianId as number) : (opts.physicianIdOverride === undefined ? undefined : (opts as any).physicianIdOverride),
								physicianNameOverride: (patientSource && patientSource.primaryPhysician) ? (patientSource.primaryPhysician as string) : ((opts as any).physicianNameOverride === undefined ? undefined : (opts as any).physicianNameOverride),
								feeScheduleOverride: (opts as any).feeScheduleOverride,
								dos: opts.dos,
								logFn,
								insuranceInsertResponse: insertInsuranceResponse,
								insuranceInsertResponses: insertInsuranceResponses,
								insurancePlanResponse: opts.insuranceCreateResult ? opts.insuranceCreateResult.plan : undefined,
								insurancePlanResponses: Array.isArray(opts.insuranceCreateResults) ? opts.insuranceCreateResults.map(r => r && r.plan).filter(Boolean) : (opts.insuranceCreateResult ? [opts.insuranceCreateResult.plan] : undefined),
								facilityIdOverride: opts.facilityId,
								insuranceType: opts.insuranceType,
								caseSummary: (isAutoMode && autoTime) ? {
									duration: 15,
									procedureStartDt: autoTime.startIso,
									procedureStopDt: autoTime.endIso,
									procedureStartTime: autoTime.startIso,
									procedureStopTime: autoTime.endIso,
									startTime: autoTime.startHHmm,
									endTime: autoTime.endHHmm,
									dateOfService: autoTime.dosText,
									procedureDt: autoTime.baseStartIso,
									roomId: (autoRoom.roomId !== undefined) ? autoRoom.roomId : undefined,
									roomName: (autoRoom.roomName) ? autoRoom.roomName : undefined,
								} : undefined,
							});
									outcomes[index - 1] = { index, request, response, fullPatient: full, createPatientResponse: created, caseSummaryResponse: cs, insertInsuranceResponse, insertInsuranceResponses, insertInsuranceError } as any;
									// release record lock for this patient
									try {
										const rel = await releaseRecordLock((patientSource && patientSource.patientId) ? (patientSource.patientId as number) : thisPid, token, apiBaseUrl);
										// suppressed releaseRecordLock response log
									} catch (e) {
										// suppressed releaseRecordLock error log
									}
									// after releasing the record lock, trigger discharge flow (best-effort)
									try {
										const passPatientId = (patientSource && patientSource.patientId) ? (patientSource.patientId as number) : thisPid;
										const passCaseSummaryId = cs && (cs.caseSummaryId || cs.caseSummaryID || cs.caseSummaryId === 0) ? (cs.caseSummaryId ?? cs.caseSummaryID) : undefined;
										const depth = flowDepthValue;
										// depth >=1 => discharge
										if (depth >= 1) {
											// suppressed discharge flow debug log
											await runDischargeFlow(opts.username, apiBaseUrl, token, logFn, passPatientId, passCaseSummaryId as any, opts.facilityId);
										}
										// depth >=2 => cases-to-code; depth >=3 => include charge entry
										if (passCaseSummaryId && depth >= 2) {
											// suppressed cases-to-code debug log
											await codingChargeEntry.performPatientCasesToCode(apiBaseUrl, String(passCaseSummaryId), token, logFn, {
												chargeEntry: depth >= 3,
												cptAmounts: (opts as any).cptAmounts,
												feeScheduleOverride: (opts as any).feeScheduleOverride,
												periodBatchOverride,
												// Bind primary insurance carrier for charge entry
												primaryInsuranceCarrierId: (function() {
													try {
														if (Array.isArray(opts.insuranceCreateResults) && opts.insuranceCreateResults.length) {
															const plan = opts.insuranceCreateResults[0] && opts.insuranceCreateResults[0].plan;
															const id = plan && (plan.insuranceCarrierId ?? plan.insuranceCarrierObjectId);
															return typeof id === 'number' ? id : undefined;
														}
														if (opts.insuranceCreateResult && opts.insuranceCreateResult.plan) {
															const plan = opts.insuranceCreateResult.plan;
															const id = plan && (plan.insuranceCarrierId ?? plan.insuranceCarrierObjectId);
															return typeof id === 'number' ? id : undefined;
														}
													} catch (e) {}
													return undefined;
												})(),
												// Provide primary patient insurance (first inserted)
												primaryPatientInsurance: (function() {
													try {
														const list = insertInsuranceResponses || (opts as any).insertInsuranceResponses;
														if (Array.isArray(list) && list.length) {
															const first = list[0];
															const pid = first && (first.patientInsuranceId ?? first.PatientInsuranceId);
															if (typeof pid === 'number') {
																const dn = first && (first.displayName ?? ((first.carrier && first.planName) ? `${first.carrier}, ${first.planName}` : undefined));
																return { patientInsuranceId: pid, displayName: dn };
															}
														}
													} catch (e) {}
													return undefined;
												})(),
											});
										}
									} catch (dfErr) {
										// suppressed discharge flow error log
									}
						} catch (csErr) {
							// attach case summary error but keep previous data
							try {
								const errAny = csErr as any;
								const msg = errAny && errAny.message ? errAny.message : String(errAny);
								outcomes[index - 1] = { index, request, response, fullPatient: full, createPatientResponse: created, caseSummaryResponse: { error: msg }, insertInsuranceResponse, insertInsuranceResponses, insertInsuranceError } as any;
							} catch (e) {}
						}
					} catch (createErr) {
						// keep original data; optionally log
					}
				} catch (e) {
					// swallow get errors but keep original response
				}
			}
		} catch (err: any) {
			const message = err && err.message ? err.message : String(err);
			outcomes[index - 1] = { index, request, error: message };
		}
	};

	let nextIndex = 1;
	const workerCount = Math.min(maxConcurrency, total);
	const workers = Array.from({ length: workerCount }, async () => {
		while (true) {
			const current = nextIndex;
			nextIndex += 1;
			if (current > total) break;
			await makeRequest(current);
		}
	});

	await Promise.all(workers);

	const results = outcomes.filter(Boolean) as CreateBasicPatientResult[];
	const hasError = results.some((o) => !!o.error);
	return { ok: !hasError, results, lastPatientId };
}

export default createBasicPatients;
