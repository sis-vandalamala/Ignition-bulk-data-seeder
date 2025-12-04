import fs from 'fs';
import path from 'path';
import merge from 'deepmerge';

import { postJson, ApiLogEntry } from '../utils/api';
import type { ICaseSummary, IPatient } from '../models/caseSummary.interface';

const CASE_SUMMARY_ENDPOINT = '/api/CaseSummaryComplex/Gemini/UpsertCaseSummary';
const templatePath = path.join(__dirname, '..', 'reqTemplates', 'caseSummary.req.json');
let cachedTemplate: ICaseSummary | null = null;

function loadCaseSummaryTemplate(): ICaseSummary {
	if (cachedTemplate) return cachedTemplate;
	try {
		const raw = fs.readFileSync(templatePath, 'utf8');
		cachedTemplate = JSON.parse(raw) as ICaseSummary;
		return cachedTemplate;
	} catch (err) {
		throw new Error(`Failed to load case summary template: ${err}`);
	}
}

function buildHeaders(token: string) {
	return {
		'Content-Type': 'text/json',
		Accept: 'text/json',
		token,
	};
}

type MergeableCaseSummary = Partial<ICaseSummary> & Record<string, any>;
type CreatePatientResult = Partial<IPatient> & Record<string, any>;

function applyCreatePatientResponse(payload: ICaseSummary, patient?: CreatePatientResult) {
	if (!patient) return payload;
	const ensurePatient = () => {
		if (!payload.patient) payload.patient = {} as IPatient;
		return payload.patient;
	};
	const targetPatient = ensurePatient();
	const hasField = (obj: any, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
	const assignPatientField = (field: keyof IPatient) => {
		if (hasField(patient, field as string)) (targetPatient as any)[field] = (patient as any)[field];
	};
	assignPatientField('patientId');
	assignPatientField('firstName');
	assignPatientField('lastName');
	assignPatientField('gender');
	assignPatientField('primaryAccountNumber');
	assignPatientField('fullName');
	assignPatientField('fullNameWithTitle');
	assignPatientField('fullNameWithTitlePrefixAsLastName');
	assignPatientField('externalId');
	assignPatientField('sourceIdentifier');
	// Java-equivalent gender logic: update only if patient.gender exists and trimmed is not empty
	if (hasField(patient, 'gender')) {
		const genderVal = (patient as any).gender;
		if (typeof genderVal === 'string' && genderVal.trim() !== '') {
			(targetPatient as any).gender = genderVal;
		}
	}

	if (patient.patientId !== undefined) {
		payload.patientId = patient.patientId;
		if (targetPatient.mpiPatientPhone) targetPatient.mpiPatientPhone.patientId = patient.patientId;
		if (targetPatient.mpiPatientPhoneSecondary) targetPatient.mpiPatientPhoneSecondary.patientId = patient.patientId;
	}

	const srcAccounts = Array.isArray(patient.accountNumbers) ? patient.accountNumbers : [];
	if (srcAccounts.length) {
		if (!Array.isArray(targetPatient.accountNumbers) || !targetPatient.accountNumbers.length) {
			targetPatient.accountNumbers = srcAccounts.map((src) => ({
				...src,
				patientId: src.patientId ?? patient.patientId ?? null,
				organizationId: src.organizationId ?? null,
				accountNumber: src.accountNumber ?? null,
				sourceIdentifier: src.sourceIdentifier ?? null,
			}));
		} else {
			targetPatient.accountNumbers = targetPatient.accountNumbers.map((entry, idx) => {
				const src = srcAccounts[idx] ?? srcAccounts[0];
				return {
					...entry,
					patientId: src.patientId ?? patient.patientId ?? entry.patientId ?? null,
					organizationId: src.organizationId ?? entry.organizationId ?? null,
					accountNumber: src.accountNumber ?? entry.accountNumber ?? null,
					sourceIdentifier: src.sourceIdentifier ?? entry.sourceIdentifier ?? null,
				};
			});
		}
	}

	if (Array.isArray(payload.caseGuarantor)) {
		payload.caseGuarantor = payload.caseGuarantor.map((item) => {
			if (!item.patientGuarantor) return item;
			const isSelf = (item.isSelf === true) || (item.patientGuarantor.patientRelationship === 'Self');
			if (!isSelf) return item; // do not override non-self guarantors
			return {
				...item,
				patientGuarantor: {
					...item.patientGuarantor,
					patientId: hasField(patient, 'patientId') ? patient.patientId : item.patientGuarantor.patientId,
					firstName: hasField(patient, 'firstName') ? patient.firstName : item.patientGuarantor.firstName,
					lastName: hasField(patient, 'lastName') ? patient.lastName : item.patientGuarantor.lastName,
					gender: hasField(patient, 'gender') ? patient.gender : item.patientGuarantor.gender,
				},
			};
		});
	}

	if (patient.roomId !== undefined) payload.roomId = patient.roomId as any;
	return payload;
}

export type CreateCaseSummaryOptions = {
	apiBaseUrl: string;
	token: string;
	caseSummary?: MergeableCaseSummary;
	patientResponse?: CreatePatientResult;
	roomIdOverride?: number;
	roomNameOverride?: string;
	appointmentTypeIdOverride?: number;
	appointmentTypeNameOverride?: string;
	physicianIdOverride?: number;
	physicianNameOverride?: string;
	// Map CPT data dynamically from a FeeSchedule response
	feeScheduleOverride?: {
		feeScheduleId: number;
		procedure: string;
		organizationId: number;
		cptProcedureId: number;
		cptProcedure: {
			cptProcedureId: number;
			cptCode: string;
			cptDescription: string;
			isHcpcsCode: boolean;
			isCdtCode: boolean;
			isCustomCode: boolean;
			sourceIdentifier: string;
		};
		modifiedProcedureDescription?: string;
		status?: string;
		amount?: number;
		effectiveDate?: string;
		feeScheduleHistoryId?: number;
		feeScheduleRootId?: number;
		activeTf?: boolean;
		isIncludeStateReportTf?: boolean;
		revenueCodeId?: number;
		typeOfBill?: string;
		itemSource?: number;
		generalLedgerToDebitId?: number | null;
		generalLedgerToCreditId?: number | null;
		enterpriseGeneralLedgerToCreditId?: number | null;
		enterpriseGeneralLedgerToDebitId?: number | null;
		isQualityIndicator?: boolean;
		procedureSpecialtyId?: number | null;
		mappedAnesthesiaCptCode?: string | null;
		asaBaseUnits?: number | null;
		cmsBaseUnits?: number | null;
		sourceIdentifier?: string;
		procedureDisplayName?: string;
	};
	timeoutMs?: number;
	logFn?: (entry: ApiLogEntry) => void;
	autoStampToday?: boolean;
	procedureAdjustments?: {
		primaryProcedureTfFirst?: boolean; // default false per latest UI example
		editableAll?: boolean; // make all procedures editable
		refreshDescriptions?: boolean; // sync modifiedProcedureDescription & procedureDisplayName from feeScheduleItem
	};
};

const mergeArraysPreferSource = (_target: any[], source: any[]) => {
	if (!Array.isArray(source)) return _target;
	return source.length ? source : _target;
};

export async function createCaseSummary({
	apiBaseUrl,
	token,
	caseSummary,
	patientResponse,
	roomIdOverride,
	roomNameOverride,
	appointmentTypeIdOverride,
	appointmentTypeNameOverride,
	physicianIdOverride,
	physicianNameOverride,
	feeScheduleOverride,
	timeoutMs = 30000,
	logFn,
	autoStampToday = true,
	procedureAdjustments,
}: CreateCaseSummaryOptions) {
	if (!apiBaseUrl) throw new Error('apiBaseUrl is required');
	if (!token) throw new Error('token is required');
	const base = String(apiBaseUrl).replace(/\/$/, '');
	const template = loadCaseSummaryTemplate();
	const payload: ICaseSummary = caseSummary
		? merge<ICaseSummary>(template, caseSummary, { arrayMerge: mergeArraysPreferSource })
		: JSON.parse(JSON.stringify(template));
	applyCreatePatientResponse(payload, patientResponse);
	// apply room id/name overrides
	if (roomIdOverride !== undefined) payload.roomId = roomIdOverride;
	// prefer explicit override, then patientResponse.roomName, then template
	if (typeof roomNameOverride === 'string' && roomNameOverride.trim() !== '') {
		payload.roomName = roomNameOverride;
	} else if (patientResponse && typeof (patientResponse as any).roomName === 'string' && (patientResponse as any).roomName.trim() !== '') {
		payload.roomName = (patientResponse as any).roomName;
	}

	// apply appointment type id/name overrides (similar to room logic)
	// Only apply appointment type name if we have an ID override
	if (appointmentTypeIdOverride !== undefined) {
		payload.appointmentTypeId = appointmentTypeIdOverride as any;
		if (typeof appointmentTypeNameOverride === 'string' && appointmentTypeNameOverride.trim() !== '') {
			(payload as any).appointmentTypeName = appointmentTypeNameOverride;
		} else if (patientResponse && typeof (patientResponse as any).appointmentTypeName === 'string' && (patientResponse as any).appointmentTypeName.trim() !== '') {
			(payload as any).appointmentTypeName = (patientResponse as any).appointmentTypeName;
		}
	}

	// apply physician overrides: set primaryPhysicianId and update all caseProcedures physician fields
	if (physicianIdOverride !== undefined) {
		(payload as any).primaryPhysicianId = physicianIdOverride as any;
		// set name if provided or pull from patientResponse
		if (typeof physicianNameOverride === 'string' && physicianNameOverride.trim() !== '') {
			(payload as any).primaryPhysician = physicianNameOverride;
		} else if (patientResponse && typeof (patientResponse as any).primaryPhysician === 'string' && (patientResponse as any).primaryPhysician.trim() !== '') {
			(payload as any).primaryPhysician = (patientResponse as any).primaryPhysician;
		}
		// update each caseProcedure physicianId/name to match override
		if (Array.isArray(payload.caseProcedures)) {
			payload.caseProcedures = payload.caseProcedures.map((cp: any) => {
				const p = { ...cp };
				p.physicianId = physicianIdOverride as any;
				if (typeof physicianNameOverride === 'string' && physicianNameOverride.trim() !== '') p.physician = physicianNameOverride;
				return p;
			});
		}
	}

	// apply CPT/FeeSchedule overrides to caseProcedures (first entry by default)
	if (feeScheduleOverride && Array.isArray(payload.caseProcedures) && payload.caseProcedures.length) {
		const fsItem = feeScheduleOverride;
		payload.caseProcedures = payload.caseProcedures.map((cp: any, idx: number) => {
			if (idx !== 0) return cp; // apply to primary/first by default
			const updated = { ...cp };
			// direct CPT fields
			updated.cptCode = fsItem.cptProcedure?.cptCode ?? updated.cptCode;
			updated.procedureDescription = fsItem.procedure ?? updated.procedureDescription;
			updated.modifiedProcedureDescription = fsItem.modifiedProcedureDescription ?? `${fsItem.cptProcedure?.cptCode ?? ''}; ${fsItem.procedure}`.trim();
			updated.procedureDisplayName = fsItem.procedureDisplayName ?? `${fsItem.cptProcedure?.cptCode ?? ''}; ${fsItem.procedure}`.trim();
			// top-level feeSchedule references (keep in sync with nested feeScheduleItem)
			updated.feeScheduleId = fsItem.feeScheduleId ?? updated.feeScheduleId;
			updated.feeScheduleHistoryId = fsItem.feeScheduleHistoryId ?? updated.feeScheduleHistoryId ?? (fsItem.feeScheduleHistoryId ?? undefined);
			updated.feeScheduleRootId = fsItem.feeScheduleRootId ?? updated.feeScheduleRootId;
			// keep physician fields as-is; only CPT mapping changes
			// attach feeScheduleItem in expected structure
			updated.feeScheduleItem = {
				feeScheduleId: fsItem.feeScheduleId,
				procedure: fsItem.procedure,
				organizationId: fsItem.organizationId,
				cptProcedureId: fsItem.cptProcedureId,
				cptProcedure: {
					cptProcedureId: fsItem.cptProcedure.cptProcedureId,
					cptCode: fsItem.cptProcedure.cptCode,
					cptDescription: fsItem.cptProcedure.cptDescription,
					isHcpcsCode: fsItem.cptProcedure.isHcpcsCode,
					isCdtCode: fsItem.cptProcedure.isCdtCode,
					isCustomCode: fsItem.cptProcedure.isCustomCode,
					sourceIdentifier: fsItem.cptProcedure.sourceIdentifier,
				},
				modifiedProcedureDescription: fsItem.modifiedProcedureDescription ?? `${fsItem.cptProcedure?.cptCode ?? ''}; ${fsItem.procedure}`.trim(),
				status: fsItem.status ?? 'Billable',
				amount: fsItem.amount ?? updated.feeScheduleItem?.amount ?? undefined,
				effectiveDate: fsItem.effectiveDate ?? updated.feeScheduleItem?.effectiveDate ?? undefined,
				feeScheduleHistoryId: fsItem.feeScheduleHistoryId ?? updated.feeScheduleItem?.feeScheduleHistoryId ?? undefined,
				feeScheduleRootId: fsItem.feeScheduleRootId ?? updated.feeScheduleItem?.feeScheduleRootId ?? undefined,
				activeTf: fsItem.activeTf ?? true,
				isIncludeStateReportTf: fsItem.isIncludeStateReportTf ?? true,
				revenueCodeId: fsItem.revenueCodeId ?? updated.feeScheduleItem?.revenueCodeId ?? undefined,
				typeOfBill: fsItem.typeOfBill ?? updated.feeScheduleItem?.typeOfBill ?? undefined,
				itemSource: fsItem.itemSource ?? updated.feeScheduleItem?.itemSource ?? 1,
				generalLedgerToDebitId: fsItem.generalLedgerToDebitId ?? null,
				generalLedgerToCreditId: fsItem.generalLedgerToCreditId ?? null,
				enterpriseGeneralLedgerToCreditId: fsItem.enterpriseGeneralLedgerToCreditId ?? null,
				enterpriseGeneralLedgerToDebitId: fsItem.enterpriseGeneralLedgerToDebitId ?? null,
				isQualityIndicator: fsItem.isQualityIndicator ?? false,
				procedureSpecialtyId: fsItem.procedureSpecialtyId ?? null,
				mappedAnesthesiaCptCode: fsItem.mappedAnesthesiaCptCode ?? null,
				asaBaseUnits: fsItem.asaBaseUnits ?? null,
				cmsBaseUnits: fsItem.cmsBaseUnits ?? null,
				sourceIdentifier: fsItem.sourceIdentifier ?? '00000000-0000-0000-0000-000000000000',
				procedureDisplayName: fsItem.procedureDisplayName ?? `${fsItem.cptProcedure?.cptCode ?? ''}; ${fsItem.procedure}`.trim(),
			};
			return updated;
		});
	}

	// no appointment type overrides here (reverted)
	if (autoStampToday) payload.today = new Date().toISOString();
	// tighten procedure mapping
	if (Array.isArray(payload.caseProcedures) && payload.caseProcedures.length) {
		const opts = procedureAdjustments || {};
		const primaryFirst = opts.primaryProcedureTfFirst === true; // default false => all false
		payload.caseProcedures = payload.caseProcedures.map((p: any, idx: number) => {
			const proc = { ...p };
			// sequence always index
			proc.procedureSequence = idx;
			// set primaryProcedureTf only if requested and first
			proc.primaryProcedureTf = primaryFirst && idx === 0 ? true : false;
			if (opts.editableAll) proc.isEditable = true;
			// refresh descriptions from feeScheduleItem if requested
			if (opts.refreshDescriptions && proc.feeScheduleItem) {
				if (!proc.modifiedProcedureDescription && proc.feeScheduleItem.modifiedProcedureDescription) {
					proc.modifiedProcedureDescription = proc.feeScheduleItem.modifiedProcedureDescription;
				}
				if (!proc.procedureDisplayName && proc.feeScheduleItem.procedureDisplayName) {
					proc.procedureDisplayName = proc.feeScheduleItem.procedureDisplayName;
				}
			}
			// ensure cptCode present if nested item has cptProcedure
			if (!proc.cptCode && proc.feeScheduleItem && proc.feeScheduleItem.cptProcedure && proc.feeScheduleItem.cptProcedure.cptCode) {
				proc.cptCode = proc.feeScheduleItem.cptProcedure.cptCode;
			}
			return proc;
		});
	}
	const url = `${base}${CASE_SUMMARY_ENDPOINT}`;
	// Post the case summary and log the UpsertCaseSummary response concisely
	console.log('[createCaseSummary] payload:', JSON.stringify(payload));
	const res = await postJson(url, payload, timeoutMs, buildHeaders(token), logFn);
	console.log('[createCaseSummary] response:', JSON.stringify(res));
	return res;
}

export default createCaseSummary;
