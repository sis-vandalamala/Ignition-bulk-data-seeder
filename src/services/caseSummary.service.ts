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
	if (roomIdOverride !== undefined) payload.roomId = roomIdOverride;
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
