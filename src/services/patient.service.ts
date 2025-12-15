import fs from 'fs';
import path from 'path';

import axios from 'axios';
import { postJson, getJson, ApiLogEntry } from '../utils/api';
import createCaseSummary from './caseSummary.service';
import { requestRecordLock, releaseRecordLock } from './support.service';
import { runDischargeFlow } from './discharge.service';
import codingChargeEntry from './codingChargeEntry.service';
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
};

export type CreateBasicPatientResult = {
	index: number;
	request: IGetDuplicatePatient;
	response?: any;
	fullPatient?: any;
	createPatientResponse?: any;
	caseSummaryResponse?: any;
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
		console.log('[createPatient] payload:', JSON.stringify(payload));
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
		console.log('[createPatient] response:', parsedResponse ?? res.data);
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
	if (!suffixValue && !isAutoMode) return { ok: false, error: 'suffix is required' };
	const total = Number(count) || 1;
	const maxConcurrency = Math.max(1, Math.min(Number(concurrency) || 8, 25));
	const base = String(apiBaseUrl).replace(/\/$/, '');
	const url = `${base}/api/PatientData/GetDuplicatePatients`;
	const headers: Record<string, string> = {
		'Content-Type': 'text/json',
		Accept: 'text/json',
		token,
	};

	const tpl = loadTemplate();
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
					try {
								// Request a record lock for this patient before creating
								let lockRes: any = null;
								try {
									lockRes = await requestRecordLock(thisPid, token, apiBaseUrl);
									try { console.log('[requestRecordLock] response:', JSON.stringify(lockRes)); } catch (e) {}
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
							const cs = await createCaseSummary({
								apiBaseUrl,
								token,
								patientResponse: patientSource,
								roomIdOverride: (patientSource && (patientSource.roomId || patientSource.roomId === 0)) ? (patientSource.roomId as number) : (opts.roomIdOverride === undefined ? undefined : opts.roomIdOverride),
								roomNameOverride: (patientSource && patientSource.roomName) ? (patientSource.roomName as string) : (opts.roomNameOverride === undefined ? undefined : opts.roomNameOverride),
								appointmentTypeIdOverride: (patientSource && (patientSource.appointmentTypeId || patientSource.appointmentTypeId === 0)) ? (patientSource.appointmentTypeId as number) : (opts.appointmentTypeIdOverride === undefined ? undefined : opts.appointmentTypeIdOverride),
								appointmentTypeNameOverride: (patientSource && patientSource.appointmentTypeName) ? (patientSource.appointmentTypeName as string) : (opts.appointmentTypeNameOverride === undefined ? undefined : opts.appointmentTypeNameOverride),
								physicianIdOverride: (patientSource && (patientSource.primaryPhysicianId || patientSource.primaryPhysicianId === 0)) ? (patientSource.primaryPhysicianId as number) : (opts.physicianIdOverride === undefined ? undefined : (opts as any).physicianIdOverride),
								physicianNameOverride: (patientSource && patientSource.primaryPhysician) ? (patientSource.primaryPhysician as string) : ((opts as any).physicianNameOverride === undefined ? undefined : (opts as any).physicianNameOverride),
								feeScheduleOverride: (opts as any).feeScheduleOverride,
								dos: opts.dos,
								logFn,
							});
									outcomes[index - 1] = { index, request, response, fullPatient: full, createPatientResponse: created, caseSummaryResponse: cs } as any;
									// release record lock for this patient
									try {
										const rel = await releaseRecordLock((patientSource && patientSource.patientId) ? (patientSource.patientId as number) : thisPid, token, apiBaseUrl);
										try { console.log('[releaseRecordLock] response:', JSON.stringify(rel)); } catch (e) {}
									} catch (e) {
										try { console.log('[releaseRecordLock] error:', String(e)); } catch (e) {}
									}
									// after releasing the record lock, trigger discharge flow (best-effort)
									try {
										const passPatientId = (patientSource && patientSource.patientId) ? (patientSource.patientId as number) : thisPid;
										const passCaseSummaryId = cs && (cs.caseSummaryId || cs.caseSummaryID || cs.caseSummaryId === 0) ? (cs.caseSummaryId ?? cs.caseSummaryID) : undefined;
										const depth = (typeof opts.flowDepth === 'number' ? opts.flowDepth : 3);
										// depth >=1 => discharge
										if (depth >= 1) {
											try { console.log('[createBasicPatients] depth>=1 runDischargeFlow', { depth, userName: opts.username, passPatientId, passCaseSummaryId, facilityId: opts.facilityId }); } catch (e) {}
											await runDischargeFlow(opts.username, apiBaseUrl, token, logFn, passPatientId, passCaseSummaryId as any, opts.facilityId);
										}
										// depth >=2 => cases-to-code; depth >=3 => include charge entry
										if (passCaseSummaryId && depth >= 2) {
											try { console.log('[createBasicPatients] depth>=2 performPatientCasesToCode', { depth, caseSummaryId: passCaseSummaryId }); } catch (e) {}
											await codingChargeEntry.performPatientCasesToCode(apiBaseUrl, String(passCaseSummaryId), token, logFn, { chargeEntry: depth >= 3, cptAmounts: (opts as any).cptAmounts, feeScheduleOverride: (opts as any).feeScheduleOverride });
										}
									} catch (dfErr) {
										try { console.log('[runDischargeFlow] error:', String(dfErr)); } catch (e) {}
									}
						} catch (csErr) {
							// attach case summary error but keep previous data
							try {
								const errAny = csErr as any;
								const msg = errAny && errAny.message ? errAny.message : String(errAny);
								outcomes[index - 1] = { index, request, response, fullPatient: full, createPatientResponse: created, caseSummaryResponse: { error: msg } } as any;
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
