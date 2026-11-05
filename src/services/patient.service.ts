import fs from 'fs';
import path from 'path';

import axios from 'axios';
import { postJson, getJson, ApiLogEntry, describeApiError } from '../utils/api';
import createCaseSummary, { getCaseSummaryTemplateDefaults } from './caseSummary.service';
import { requestRecordLock, releaseRecordLock, getPeriodBatches, createPeriod, createBatch, getRoomsForOrganization, getAppointmentTypeNameAndID, getFeeSchedules, getExternalFacilities } from './support.service';
import { runDischargeFlow } from './discharge.service';
import { verifyAnesthesiaCase, documentAnesthesiaCase, getAnesthesiaCaseStatus } from './anesthesiaBilling.service';
import codingChargeEntry, { type ChargeEntryPeriodBatch } from './codingChargeEntry.service';
import { insertInsuranceGemini, createInsertInsurancePayload, type InsuranceInsertOverrides, type CreateInsuranceResult } from './insurance.service';
import type { IGetDuplicatePatient } from '../models/getDuplicatePatients.interface';

// module loaded (no debug log)

const duplicatePatientTemplatePath = path.join(__dirname, '..', 'reqTemplates', 'getDuplicatePatients.req.json');
const createPatientTemplatePath = path.join(__dirname, '..', 'reqTemplates', 'createPatient.req.json');
let duplicatePatientTemplate: IGetDuplicatePatient | null = null;
const createPatientAnesBillingTemplatePath = path.join(__dirname, '..', 'reqTemplates', 'createPatient.anesBilling.req.json');
let createPatientTemplate: any | null = null;
let createPatientAnesBillingTemplate: any | null = null;

const AUTO_FIRST_NAMES = [
	'Avery', 'Atlas', 'Beck', 'Calla', 'Dorian', 'Elowen', 'Finn', 'Galen', 'Harbor', 'Indigo', 'Junia', 'Kai', 'Lennox', 'Mira', 'Nash', 'Opal', 'Pax', 'Quinn', 'Rowan', 'Sage', 'Thalia', 'Vera', 'Wyatt', 'Xander', 'Yara', 'Zane'
];

const AUTO_LAST_NAMES = [
	'Alder', 'Briar', 'Calder', 'Dalton', 'Ellis', 'Fletcher', 'Grady', 'Hayes', 'Iverson', 'Jensen', 'Keaton', 'Larkin', 'Mercer', 'North', 'Orwell', 'Prescott', 'Quill', 'Ridley', 'Sterling', 'Tate', 'Ulrich', 'Vance', 'Whitley', 'York', 'Zeller'
];

const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CASE_BATCH_SIZE = 120;
const BATCH_DELAY_MS = 5000;

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

function extractApptTypeId(a: any): number | undefined {
	const candidates = [a?.appointmentTypeId, a?.AppointmentTypeId, a?.appointmentTypeID, a?.id, a?.value];
	for (const c of candidates) {
		const n = Number(c);
		if (!Number.isNaN(n) && n > 0) return n;
	}
	return undefined;
}

function extractApptTypeName(a: any): string | undefined {
	const candidates = [a?.appointment_Type_Desc, a?.appTypeDesc, a?.description, a?.name, a?.label];
	for (const c of candidates) {
		if (typeof c === 'string' && c.trim()) return c.trim();
	}
	return undefined;
}

function pickRandomApptType(apptTypes: any[]): { appointmentTypeId?: number; appointmentTypeName?: string } {
	if (!Array.isArray(apptTypes) || apptTypes.length === 0) return {};
	const idx = Math.floor(Math.random() * apptTypes.length);
	const chosen = apptTypes[idx];
	return { appointmentTypeId: extractApptTypeId(chosen), appointmentTypeName: extractApptTypeName(chosen) };
}

// An appointment type can only be used for a case when it is active and mapped to a case pack.
// UpsertCaseSummary rejects a case for an appointment type with casePackId 0 (e.g. "Gem_Business")
// with an empty 400, which made roughly 1 in N auto-mode cases fail at random.
export function isUsableAppointmentType(a: any, dos?: string | Date): boolean {
	if (!a || typeof a !== 'object') return false;
	if (a.isAppointmentTypeActive === false) return false;
	if (a.casePackId !== undefined && a.casePackId !== null) {
		const cp = Number(a.casePackId);
		if (Number.isNaN(cp) || cp <= 0) return false;
	}
	// Each appointment type carries the case type to create before / after its start date (1 = regular case).
	// Any other value creates a non-case appointment that SIS shows as "Removed" (e.g. "Test Cases": after = 4).
	const when = dos ? new Date(dos) : new Date();
	const start = a.startDt ? new Date(a.startDt) : null;
	const applicable = start && !Number.isNaN(start.getTime()) && !Number.isNaN(when.getTime()) && when >= start
		? a.caseTypeAfterStartDate
		: a.caseTypeBeforeStartDate;
	if (applicable !== undefined && applicable !== null && Number(applicable) !== 1) return false;
	return true;
}

function pickRandomFeeSchedule(feeSchedules: any[]): any | undefined {
	if (!Array.isArray(feeSchedules) || feeSchedules.length === 0) return undefined;
	const idx = Math.floor(Math.random() * feeSchedules.length);
	return feeSchedules[idx];
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

function loadCreatePatientTemplate(isAnesthesiaBilling = false) {
	if (isAnesthesiaBilling) {
		if (createPatientAnesBillingTemplate) return createPatientAnesBillingTemplate;
		try {
			createPatientAnesBillingTemplate = JSON.parse(fs.readFileSync(createPatientAnesBillingTemplatePath, 'utf8'));
		} catch (err) {
			throw new Error(`Failed to load createPatient anesthesia billing template: ${err}`);
		}
		return createPatientAnesBillingTemplate!;
	}
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
    isAnesthesiaBilling?: boolean; // true when logged-in facility entityType is Anes Billing; clinical payloads otherwise
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
	// Called once per case as soon as it passes or fails (drives live progress)
	onCaseComplete?: (result: CreateBasicPatientResult, totals: CaseRunTotals) => void;
	// Called when a case moves to a new stage
	onCaseStage?: (index: number, stage: CaseStage) => void;
};

export type CaseStage = 'findPatient' | 'getPatient' | 'recordLock' | 'createPatient' | 'createCase' | 'discharge' | 'casesToCode' | 'chargeEntry' | 'insuranceVerification' | 'clinicalDocumentation';

export const CASE_STAGE_LABELS: Record<CaseStage, string> = {
	findPatient: 'Find patient (GetDuplicatePatients)',
	getPatient: 'Load patient (GetPatient)',
	recordLock: 'Patient record lock',
	createPatient: 'Save patient (CreatePatient)',
	createCase: 'Create case (UpsertCaseSummary)',
	discharge: 'Discharge',
	casesToCode: 'Cases to Code',
	chargeEntry: 'Charge Entry',
	insuranceVerification: 'Insurance verification (Financial Clearance)',
	clinicalDocumentation: 'Clinical documentation (Performed)',
};

export type CaseRunTotals = { total: number; completed: number; passed: number; failed: number };

export type CreateBasicPatientResult = {
	index: number;
	status: 'passed' | 'failed';
	failedStage?: CaseStage;
	failedStageLabel?: string;
	completedStages: CaseStage[];
	patientId?: number;
	patientName?: string;
	caseSummaryId?: number;
	warnings?: string[];
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




export async function createPatient(apiBaseUrl: string, token: string, patientPayload: any, logFn?: (entry: ApiLogEntry) => void, extraHeaders?: Record<string, string>, isAnesthesiaBilling = false) {
	const base = String(apiBaseUrl).replace(/\/$/, '');
	const url = `${base}/api/PatientData/Gemini/CreatePatient/2030`;
	const template = loadCreatePatientTemplate(isAnesthesiaBilling);
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
			timeout: 180000,
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
	const runWarnings: string[] = [];
	// Reference data for the logged-in org. Rooms and appointment types are loaded in manual mode too,
	// so template fallbacks (captured in another org) can be validated before any patient is created.
	let roomsList: any[] = [];
	let apptTypesList: any[] = [];
	let feeSchedulesList: any[] = [];
	try {
		const rr: any = await getRoomsForOrganization(token, apiBaseUrl);
		roomsList = Array.isArray(rr) ? rr : (Array.isArray(rr?.rooms) ? rr.rooms : []);
	} catch (e) {
		runWarnings.push(`Could not load rooms: ${describeApiError(e)}`);
	}
	try {
		const at: any = await getAppointmentTypeNameAndID(token, apiBaseUrl);
		apptTypesList = Array.isArray(at) ? at : [];
	} catch (e) {
		runWarnings.push(`Could not load appointment types: ${describeApiError(e)}`);
	}
	const usableApptTypes = apptTypesList.filter((a) => isUsableAppointmentType(a, opts.dos));
	const unusableApptTypes = apptTypesList.filter((a) => !isUsableAppointmentType(a, opts.dos));
	if (isAutoMode) {
		if (unusableApptTypes.length) {
			runWarnings.push(`Skipping appointment type(s) that cannot create a regular case (no case pack / inactive / non-case type for this DOS): ${unusableApptTypes.map((a) => `${extractApptTypeName(a) ?? '?'} (${extractApptTypeId(a) ?? '?'})`).join(', ')}`);
		}
		try {
			const fsRes: any = await getFeeSchedules(token, apiBaseUrl, opts.extraHeaders);
			const all = Array.isArray(fsRes) ? fsRes : [];
			const active = all.filter((f: any) => f && f.activeTf !== false);
			const forOrg = facilityId ? active.filter((f: any) => f.organizationId === undefined || Number(f.organizationId) === Number(facilityId)) : active;
			feeSchedulesList = forOrg.length ? forOrg : active;
			if (opts.isAnesthesiaBilling) {
				// Anes Billing coding needs a surgical CPT mapped to an anesthesia CPT (mappedAnesthesiaProcedure);
				// unmapped items (e.g. "Surg2") cannot be added to performed procedures.
				const mapped = feeSchedulesList.filter((f: any) => f && (f.mappedAnesthesiaCptCode || f.mappedAnesthesiaProcedure || f.mappedAnesthesiaCptProcedureId));
				if (mapped.length) feeSchedulesList = mapped;
				else runWarnings.push(`No fee schedule in org ${facilityId ?? '?'} is mapped to an anesthesia CPT — Anes Billing cases cannot be coded/charged.`);
			}
		} catch (e) {
			runWarnings.push(`Could not load fee schedules: ${describeApiError(e)}`);
		}
		if (!feeSchedulesList.length) runWarnings.push(`No fee schedules returned for org ${facilityId ?? '?'} — cases use the template CPT, which may not exist in this org.`);
	}
	const findApptType = (id?: number) => (typeof id === 'number' ? apptTypesList.find((a) => extractApptTypeId(a) === id) : undefined);
	const findRoom = (id?: number) => (typeof id === 'number' ? roomsList.find((r) => extractRoomId(r) === id) : undefined);

	// Manual mode: resolve room / appointment type once and validate them up front.
	let manualRoom: { roomId?: number; roomName?: string } = {};
	let manualAppt: { appointmentTypeId?: number; appointmentTypeName?: string } = {};
	if (!isAutoMode) {
		const tplDefaults = getCaseSummaryTemplateDefaults(!!opts.isAnesthesiaBilling);
		if (typeof opts.roomIdOverride === 'number') {
			manualRoom = { roomId: opts.roomIdOverride, roomName: opts.roomNameOverride };
		} else if (roomsList.length && !findRoom(tplDefaults.roomId)) {
			const r = roomsList.find((x) => x && x.activeTf !== false) ?? roomsList[0];
			manualRoom = { roomId: extractRoomId(r), roomName: extractRoomName(r) };
			runWarnings.push(`No room selected and the template room (${tplDefaults.roomId}) is not in this org — using room "${manualRoom.roomName}" (${manualRoom.roomId}).`);
		}
		if (typeof opts.appointmentTypeIdOverride === 'number') {
			const sel = findApptType(opts.appointmentTypeIdOverride);
			if (sel && !isUsableAppointmentType(sel, opts.dos)) {
				throw new Error(`Appointment type "${extractApptTypeName(sel) ?? opts.appointmentTypeNameOverride ?? ''}" (${opts.appointmentTypeIdOverride}) cannot create a regular case on this date (no case pack mapped, inactive, or its case type for this DOS is not "Case"); the case would fail or be created as Removed. Choose another appointment type or map a case pack to it in configuration.`);
			}
			manualAppt = { appointmentTypeId: opts.appointmentTypeIdOverride, appointmentTypeName: opts.appointmentTypeNameOverride };
		} else if (usableApptTypes.length) {
			const tplAppt = findApptType(tplDefaults.appointmentTypeId);
			if (!tplAppt || !isUsableAppointmentType(tplAppt, opts.dos)) {
				const a = usableApptTypes[0];
				manualAppt = { appointmentTypeId: extractApptTypeId(a), appointmentTypeName: extractApptTypeName(a) };
				runWarnings.push(`No appointment type selected and the template one (${tplDefaults.appointmentTypeId}) is not usable in this org — using "${manualAppt.appointmentTypeName}" (${manualAppt.appointmentTypeId}).`);
			}
		}
	}
	if (isAutoMode && apptTypesList.length && !usableApptTypes.length) {
		throw new Error(`None of the org's appointment types has a case pack mapped (${apptTypesList.map((a) => extractApptTypeName(a)).join(', ')}); cases cannot be created.`);
	}

	// Anes Billing: resolve the place of service from the org's external facilities (first one)
	let placeOfService: { id: number; value: string } | undefined;
	if (opts.isAnesthesiaBilling && opts.facilityId) {
		try {
			const ef: any = await getExternalFacilities(token, apiBaseUrl, Number(opts.facilityId), opts.extraHeaders);
			const list: any[] = Array.isArray(ef) ? ef : (ef?.result || ef?.data || ef?.items || []);
			// each item: { extOrganizationId, extFacilityName, activeTf, ... }; prefer the first active facility
			const first = Array.isArray(list) ? (list.find((f: any) => f && f.activeTf !== false) ?? list[0]) : undefined;
			if (first && typeof first.extOrganizationId === 'number' && typeof first.extFacilityName === 'string' && first.extFacilityName) {
				placeOfService = { id: first.extOrganizationId, value: first.extFacilityName };
			}
		} catch (e) {
			placeOfService = undefined; // keep template values
			runWarnings.push(`Could not load external facilities (place of service): ${describeApiError(e)}`);
		}
	}
	const pickAutoName = isAutoMode ? createAutoNameFactory() : null;
	const outcomes: Array<CreateBasicPatientResult | undefined> = new Array(total);
	let lastPatientId: number | null = null;
	const totals: CaseRunTotals = { total, completed: 0, passed: 0, failed: 0 };

	const primaryInsuranceCarrierId = (() => {
		try {
			const plan = Array.isArray(opts.insuranceCreateResults) && opts.insuranceCreateResults.length
				? opts.insuranceCreateResults[0] && opts.insuranceCreateResults[0].plan
				: (opts.insuranceCreateResult ? opts.insuranceCreateResult.plan : undefined);
			const id = plan && (plan.insuranceCarrierId ?? plan.insuranceCarrierObjectId);
			return typeof id === 'number' ? id : undefined;
		} catch (e) { return undefined; }
	})();
	const toPatientInsurance = (ins: any) => {
		const pid = ins && (ins.patientInsuranceId ?? ins.PatientInsuranceId);
		if (typeof pid !== 'number') return undefined;
		const dn = ins.displayName ?? ((ins.carrier && ins.planName) ? `${ins.carrier}, ${ins.planName}` : undefined);
		return { patientInsuranceId: pid, displayName: dn };
	};

	const formatStageError = (stage: CaseStage, err: any) => {
		let msg = describeApiError(err);
		const ctx = err && (err as any).caseContext;
		if (ctx) msg += ` | Case values sent: ${ctx}`;
		const status = err && err.response ? err.response.status : undefined;
		if (stage === 'createCase' && status === 400) {
			msg += ' | Hint: an empty 400 from UpsertCaseSummary usually means one of these IDs is not valid for this org (appointment type without a case pack, or a room / physician / fee schedule from another org).';
		}
		return `${CASE_STAGE_LABELS[stage]}: ${msg}`;
	};

	const makeRequest = async (index: number) => {
		const autoName = isAutoMode && pickAutoName ? pickAutoName(index) : null;
		const request: IGetDuplicatePatient = {
			...tpl,
			firstName: autoName ? autoName.firstName : `InPFname${suffixValue}v${index}`,
			lastName: autoName ? autoName.lastName : `InPLname${suffixValue}v${index}`,
		};
		const out: CreateBasicPatientResult = { index, request, status: 'failed', completedStages: [], patientName: `${request.firstName} ${request.lastName}` };
		const warnings: string[] = [];
		let stage = 'findPatient' as CaseStage;
		const enter = (next: CaseStage) => {
			stage = next;
			try { if (opts.onCaseStage) opts.onCaseStage(index, next); } catch (e) {}
		};
		const done = (st: CaseStage) => { out.completedStages.push(st); };
		let lockedPatientId: number | null = null;
		const releaseLock = async () => {
			if (lockedPatientId === null) return;
			const pidToRelease = lockedPatientId;
			lockedPatientId = null;
			try { await releaseRecordLock(pidToRelease, token, apiBaseUrl); } catch (e) { warnings.push(`ReleaseLock(patient ${pidToRelease}) failed: ${describeApiError(e)}`); }
		};
		try {
			enter('findPatient');
			const response = await postJson(url, request, 20000, headers, logFn);
			out.response = response;
			const thisPid = Array.isArray(response) && response.length ? firstValidNumber([response[0] && response[0].patientId]) : undefined;
			if (!thisPid) throw new Error(`GetDuplicatePatients returned no patientId for ${request.firstName} ${request.lastName} (response: ${JSON.stringify(response).slice(0, 300)})`);
			lastPatientId = thisPid;
			out.patientId = thisPid;
			done('findPatient');

			enter('getPatient');
			const full = await getPatient(apiBaseUrl, thisPid, token, logFn);
			out.fullPatient = full;
			done('getPatient');

			enter('recordLock');
			const lockRes: any = await requestRecordLock(thisPid, token, apiBaseUrl);
			if (lockRes && lockRes.error) throw new Error(`RequestLock returned an error: ${typeof lockRes.error === 'string' ? lockRes.error : JSON.stringify(lockRes.error)}`);
			lockedPatientId = thisPid;
			done('recordLock');

			enter('createPatient');
			let created: any;
			for (let attempt = 1; ; attempt += 1) {
				try {
					created = await createPatient(apiBaseUrl, token, full, logFn, opts.extraHeaders, !!opts.isAnesthesiaBilling);
					break;
				} catch (e: any) {
					// Under concurrency the API occasionally reports the patient lock as missing right after
					// RequestLock succeeded ("RecordLock-Patient record lock is required ..."). Re-lock and retry.
					const body = e && e.response && e.response.data ? JSON.stringify(e.response.data) : '';
					const lockMissing = e && e.response && e.response.status === 400 && /record\s*lock/i.test(body);
					if (!lockMissing || attempt >= 3) throw e;
					warnings.push(`CreatePatient attempt ${attempt} said the patient record lock was missing; re-locked and retried.`);
					await sleep(400 * attempt);
					await requestRecordLock(thisPid, token, apiBaseUrl);
				}
			}
			out.createPatientResponse = created;
			// Prefer the API response if present; otherwise the authoritative GetPatient object; finally the request we sent.
			const patientSource: any = (created && created.response != null && typeof created.response === 'object')
				? created.response
				: (full ?? (created && created.request ? created.request : full));
			try {
				const srcGender = created && created.request && (created.request as any).gender ? (created.request as any).gender : null;
				if (srcGender && patientSource && (!patientSource.gender || (typeof patientSource.gender === 'string' && patientSource.gender.trim() === ''))) {
					patientSource.gender = srcGender;
				}
			} catch (e) {}
			done('createPatient');

			// Insurance binding (non-fatal: the case is still created, the problem is reported as a warning)
			let insertInsuranceResponse: any = undefined;
			let insertInsuranceResponses: any[] | undefined = undefined;
			const overridesList = Array.isArray(opts.insuranceInsertOverridesList) && opts.insuranceInsertOverridesList.length
				? opts.insuranceInsertOverridesList
				: (opts.insuranceInsertOverrides ? null : undefined);
			if (overridesList !== undefined) {
				const patientIdForInsert = firstValidNumber([
					patientSource && patientSource.patientId,
					created && created.request ? (created.request as any).patientId : undefined,
					full ? (full as any).patientId : undefined,
					thisPid,
				]);
				const patientFirstName = firstNonEmptyString([patientSource && patientSource.firstName, full ? (full as any).firstName : undefined, request.firstName]);
				const patientLastName = firstNonEmptyString([patientSource && patientSource.lastName, full ? (full as any).lastName : undefined, request.lastName]);
				const insertOne = async (ov: InsuranceInsertOverrides | undefined) => insertInsuranceGemini({
					apiBaseUrl,
					token,
					payload: createInsertInsurancePayload({ ...(ov ?? {}), patientId: patientIdForInsert, firstName: patientFirstName ?? request.firstName, lastName: patientLastName ?? request.lastName }),
					timeoutMs: insertInsuranceTimeout,
					extraHeaders: opts.extraHeaders,
					logFn,
				});
				try {
					if (overridesList) {
						insertInsuranceResponses = [];
						for (const ov of overridesList) insertInsuranceResponses.push(await insertOne(ov));
					} else {
						insertInsuranceResponse = await insertOne(opts.insuranceInsertOverrides);
					}
				} catch (insertErr) {
					out.insertInsuranceError = describeApiError(insertErr);
					warnings.push(`Insurance not attached to patient: ${out.insertInsuranceError}`);
				}
			}
			out.insertInsuranceResponse = insertInsuranceResponse;
			out.insertInsuranceResponses = insertInsuranceResponses;

			enter('createCase');
			// Auto overrides: room, appointment type, fee schedule + randomized 15-min slot across the day
			const autoTime = isAutoMode ? generateRandom15MinSlot(opts.dos) : null;
			const autoRoom = isAutoMode ? pickRandomRoom(roomsList) : {};
			const autoApptType = isAutoMode ? pickRandomApptType(usableApptTypes.length ? usableApptTypes : apptTypesList) : {};
			const autoFeeSchedule = isAutoMode ? pickRandomFeeSchedule(feeSchedulesList) : undefined;
			const chosenRoom = isAutoMode ? autoRoom : manualRoom;
			const chosenAppt = isAutoMode ? autoApptType : manualAppt;
			const has = (v: any) => v !== undefined && v !== null;
			const cs = await createCaseSummary({
				apiBaseUrl,
				token,
				patientResponse: patientSource,
				roomIdOverride: (patientSource && has(patientSource.roomId)) ? (patientSource.roomId as number) : chosenRoom.roomId,
				roomNameOverride: (patientSource && patientSource.roomName) ? (patientSource.roomName as string) : chosenRoom.roomName,
				appointmentTypeIdOverride: (patientSource && has(patientSource.appointmentTypeId)) ? (patientSource.appointmentTypeId as number) : chosenAppt.appointmentTypeId,
				appointmentTypeNameOverride: (patientSource && patientSource.appointmentTypeName) ? (patientSource.appointmentTypeName as string) : chosenAppt.appointmentTypeName,
				physicianIdOverride: (patientSource && has(patientSource.primaryPhysicianId)) ? (patientSource.primaryPhysicianId as number) : opts.physicianIdOverride,
				physicianNameOverride: (patientSource && patientSource.primaryPhysician) ? (patientSource.primaryPhysician as string) : opts.physicianNameOverride,
				feeScheduleOverride: (opts as any).feeScheduleOverride ?? autoFeeSchedule,
				isAnesthesiaBilling: !!opts.isAnesthesiaBilling,
				placeOfService,
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
			out.caseSummaryResponse = cs;
			const caseSummaryId = cs ? firstValidNumber([cs.caseSummaryId, cs.caseSummaryID]) : undefined;
			if (!caseSummaryId) throw new Error(`UpsertCaseSummary returned no caseSummaryId (response: ${JSON.stringify(cs).slice(0, 300)})`);
			out.caseSummaryId = caseSummaryId;
			const appointmentId = cs ? firstValidNumber([cs.appointmentId]) : undefined;
			done('createCase');
			await releaseLock();

			const passPatientId = firstValidNumber([patientSource && patientSource.patientId, thisPid]) as number;
			if (opts.isAnesthesiaBilling) {
				// Anesthesia Billing: Financial Clearance -> Verification Complete -> Clinical Documentation -> Coding/Charge Entry tracker
				if (flowDepthValue >= 1) {
					enter('insuranceVerification');
					await verifyAnesthesiaCase(apiBaseUrl, token, caseSummaryId, logFn);
					done('insuranceVerification');
					enter('clinicalDocumentation');
					await documentAnesthesiaCase(apiBaseUrl, token, caseSummaryId, opts.facilityId, logFn);
					// confirm the case really is Performed (it only then shows in the Coding/Charge Entry tracker)
					const finalStatus = await getAnesthesiaCaseStatus(apiBaseUrl, token, caseSummaryId, logFn).catch(() => undefined);
					if (finalStatus && !/^performed$/i.test(finalStatus)) {
						throw new Error(`Case ${caseSummaryId} is "${finalStatus}" after documentation (expected Performed), so it will not appear in the Coding/Charge Entry tracker.`);
					}
					done('clinicalDocumentation');
				}
				out.status = 'passed';
				return;
			}
			if (flowDepthValue >= 1) {
				enter('discharge');
				const d = await runDischargeFlow(opts.username, apiBaseUrl, token, logFn, passPatientId, caseSummaryId, opts.facilityId, appointmentId);
				if (d.warnings && d.warnings.length) warnings.push(...d.warnings.map((w) => `Discharge: ${w}`));
				if (!d.ok) throw new Error(d.error || 'Discharge failed');
				done('discharge');
			}
			if (flowDepthValue >= 2) {
				enter('casesToCode');
				const listIns = insertInsuranceResponses && insertInsuranceResponses.length ? insertInsuranceResponses[0] : undefined;
				const c = await codingChargeEntry.performPatientCasesToCode(apiBaseUrl, String(caseSummaryId), token, logFn, {
					chargeEntry: flowDepthValue >= 3,
					cptAmounts: (opts as any).cptAmounts,
					feeScheduleOverride: (opts as any).feeScheduleOverride,
					periodBatchOverride,
					primaryInsuranceCarrierId,
					primaryPatientInsurance: toPatientInsurance(listIns) ?? toPatientInsurance(insertInsuranceResponse),
					appointmentId,
				});
				if (!c.ok) {
					if (c.failedStage === 'chargeEntry') { done('casesToCode'); enter('chargeEntry'); }
					throw new Error(c.error || 'Cases to Code failed');
				}
				done('casesToCode');
				if (flowDepthValue >= 3) done('chargeEntry');
			}
			out.status = 'passed';
		} catch (err: any) {
			out.status = 'failed';
			out.failedStage = stage;
			out.failedStageLabel = CASE_STAGE_LABELS[stage];
			out.error = formatStageError(stage, err);
			if (stage === 'createCase') out.caseSummaryResponse = { error: out.error };
		} finally {
			await releaseLock();
			if (warnings.length) out.warnings = warnings;
			outcomes[index - 1] = out;
			totals.completed += 1;
			if (out.status === 'passed') totals.passed += 1; else totals.failed += 1;
			try { if (opts.onCaseComplete) opts.onCaseComplete(out, { ...totals }); } catch (e) {}
		}
	};

				const processBatch = async (startIndex: number, endIndex: number) => {
					let nextIndex = startIndex;
					const workerCount = Math.min(maxConcurrency, endIndex - startIndex + 1);
					const workers = Array.from({ length: workerCount }, async () => {
						while (true) {
							const current = nextIndex;
							nextIndex += 1;
							if (current > endIndex) break;
							await makeRequest(current);
						}
					});
					await Promise.all(workers);
				};

				const totalBatches = Math.ceil(total / CASE_BATCH_SIZE);
				for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
					const startIndex = batchIndex * CASE_BATCH_SIZE + 1;
					const endIndex = Math.min(total, startIndex + CASE_BATCH_SIZE - 1);
					const batchStartMs = Date.now();
					try { if (logFn) logFn({ url: 'createBasicPatients', method: 'BATCH', status: `start-${batchIndex + 1}`, timestamp: new Date().toISOString() } as any); } catch (e) {}
					await processBatch(startIndex, endIndex);
					const batchDuration = Date.now() - batchStartMs;
					try { if (logFn) logFn({ url: 'createBasicPatients', method: 'BATCH', status: `ok-${batchIndex + 1}`, durationMs: batchDuration, timestamp: new Date().toISOString() } as any); } catch (e) {}
					if (batchIndex < totalBatches - 1) {
						await sleep(BATCH_DELAY_MS);
					}
				}

	const results = outcomes.filter(Boolean) as CreateBasicPatientResult[];
	const failuresByStage: Record<string, number> = {};
	results.filter((r) => r.status === 'failed').forEach((r) => {
		const k = r.failedStageLabel || 'Unknown';
		failuresByStage[k] = (failuresByStage[k] || 0) + 1;
	});
	const summary = { total, passed: totals.passed, failed: totals.failed, failuresByStage };
	return { ok: totals.failed === 0, results, lastPatientId, summary, warnings: runWarnings };
}

export default createBasicPatients;
