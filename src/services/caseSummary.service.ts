import fs from 'fs';
import path from 'path';
import merge from 'deepmerge';

import { postJson, ApiLogEntry } from '../utils/api';
import type { ICaseSummary, IPatient } from '../models/caseSummary.interface';

const CASE_SUMMARY_ENDPOINT = '/api/CaseSummaryComplex/Gemini/UpsertCaseSummary';
const templatePath = path.join(__dirname, '..', 'reqTemplates', 'caseSummary.req.json');
const caseGuarantorTemplatePath = path.join(__dirname, '..', 'reqTemplates', 'caseGuarantor.json');
const caseInsurancesTemplatePath = path.join(__dirname, '..', 'reqTemplates', 'caseInsurances.json');

let cachedTemplate: ICaseSummary | null = null;
let cachedCaseGuarantorTemplate: any | null = null;
let cachedCaseInsurancesTemplate: any | null = null;

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

function loadCaseGuarantorTemplate(): any {
	if (cachedCaseGuarantorTemplate) return cachedCaseGuarantorTemplate;
	try {
		const raw = fs.readFileSync(caseGuarantorTemplatePath, 'utf8');
		cachedCaseGuarantorTemplate = JSON.parse(raw);
		return cachedCaseGuarantorTemplate;
	} catch (err) {
		throw new Error(`Failed to load case guarantor template: ${err}`);
	}
}

function loadCaseInsurancesTemplate(): any {
	if (cachedCaseInsurancesTemplate) return cachedCaseInsurancesTemplate;
	try {
		const raw = fs.readFileSync(caseInsurancesTemplatePath, 'utf8');
		cachedCaseInsurancesTemplate = JSON.parse(raw);
		return cachedCaseInsurancesTemplate;
	} catch (err) {
		throw new Error(`Failed to load case insurances template: ${err}`);
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

type InsuranceMappingOptions = {
	insuranceInsertResponse?: any; // backward compatibility: single response
	insuranceInsertResponses?: any[]; // preferred: multiple responses
	insurancePlanResponse?: any; // backward compatibility: single plan
	insurancePlanResponses?: any[]; // preferred: multiple plans
	facilityIdOverride?: number;
	insuranceType?: string;
};

function applyInsuranceMapping(payload: ICaseSummary, opts?: InsuranceMappingOptions) {
	if (!opts) return payload;
	const { insuranceInsertResponse, insuranceInsertResponses, insurancePlanResponse, insurancePlanResponses, facilityIdOverride, insuranceType } = opts;
	const typeValue = typeof insuranceType === 'string' ? insuranceType.trim().toLowerCase() : '';
	if (typeValue !== 'create') return payload;
	// normalize to array of insert responses
	const insertList: any[] = Array.isArray(insuranceInsertResponses)
		? insuranceInsertResponses.filter(Boolean)
		: (insuranceInsertResponse && typeof insuranceInsertResponse === 'object') ? [insuranceInsertResponse] : [];
	if (!insertList.length) return payload;

	const hasField = (obj: any, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
	// Safely clone templates so cached versions remain immutable
	let guarantorTemplate: any;
	let insTemplate: any;
	try {
		guarantorTemplate = JSON.parse(JSON.stringify(loadCaseGuarantorTemplate() || {}));
		insTemplate = JSON.parse(JSON.stringify(loadCaseInsurancesTemplate() || {}));
	} catch (e) {
		// If template loading fails, leave payload unchanged
		return payload;
	}

	try {
		const guArr = Array.isArray(guarantorTemplate.caseGuarantor) ? guarantorTemplate.caseGuarantor : [];
		// Primary guarantor (index 0) mapping
		if (guArr.length > 0 && guArr[0] && guArr[0].patientGuarantor) {
			const pg = guArr[0].patientGuarantor as any;
			const src0 = insertList[0] || insuranceInsertResponse;
			if (src0 && hasField(src0, 'patientId')) pg.patientId = src0.patientId;
			if (src0 && hasField(src0, 'firstName')) pg.firstName = src0.firstName;
			if (src0 && hasField(src0, 'lastName')) pg.lastName = src0.lastName;
			// keep isSelf true for primary row per template
			if (typeof (guArr[0] as any).isSelf !== 'boolean') (guArr[0] as any).isSelf = true;
			if (typeof (guArr[0] as any).isActive !== 'boolean') (guArr[0] as any).isActive = true;
		}
		// If there is secondary insurance, ensure second guarantor row is active and self
		if (insertList.length > 1) {
			// Ensure the row exists
			if (!guArr[1]) {
				guArr[1] = { sortOrder: 2, isActive: true, isSelf: true, patientGuarantor: {} } as any;
			}
			const g2 = guArr[1] as any;
			g2.isActive = true;
			g2.isSelf = true;
			g2.sortOrder = typeof g2.sortOrder === 'number' ? g2.sortOrder : 2;
			if (!g2.patientGuarantor) g2.patientGuarantor = {};
			const pg2 = g2.patientGuarantor as any;
			const src = insertList[1] || insertList[0] || insuranceInsertResponse;
			if (src && hasField(src, 'patientId')) pg2.patientId = src.patientId;
			if (src && hasField(src, 'firstName')) pg2.firstName = src.firstName;
			if (src && hasField(src, 'lastName')) pg2.lastName = src.lastName;
			// If gender exists on src, copy; otherwise leave template/default
			if (src && hasField(src, 'gender') && typeof src.gender === 'string' && src.gender.trim() !== '') pg2.gender = src.gender;
			// Ensure relationship remains Self
			if (typeof pg2.patientRelationship === 'undefined') pg2.patientRelationship = 'Self';
		}
		if (guArr.length) {
			(payload as any).caseGuarantor = guArr;
		}
	} catch (e) {
		// ignore guarantor mapping errors
	}

	try {
		const insArr = Array.isArray(insTemplate.caseInsurances) ? insTemplate.caseInsurances : [];
		// ensure we have at least as many slots as responses (template already has 3)
		for (let i = 0; i < insertList.length && i < insArr.length; i += 1) {
			const slot = insArr[i];
			if (!slot || !slot.patientInsurance) continue;
			const pi = slot.patientInsurance as any;
			const src = insertList[i] as any;
			if (hasField(src, 'patientInsuranceId')) pi.patientInsuranceId = src.patientInsuranceId;
			if (hasField(src, 'patientId')) pi.patientId = src.patientId;
			if (hasField(src, 'insuredId')) pi.insuredId = src.insuredId;
			if (hasField(src, 'insuranceId')) pi.insuranceId = src.insuranceId;
			if (hasField(src, 'insuranceCarrierId')) pi.insuranceCarrierId = src.insuranceCarrierId;
			if (hasField(src, 'insurancePlanId')) pi.insurancePlanId = src.insurancePlanId;
			if (hasField(src, 'carrier')) pi.carrier = src.carrier;
			if (hasField(src, 'firstName')) pi.firstName = src.firstName;
			if (hasField(src, 'lastName')) pi.lastName = src.lastName;
			if (hasField(src, 'insuranceClaimOfficeId')) pi.insuranceClaimOfficeId = src.insuranceClaimOfficeId;
			if (typeof facilityIdOverride === 'number' && !Number.isNaN(facilityIdOverride)) {
				pi.organizationId = facilityIdOverride;
			}
			const plan = Array.isArray(insurancePlanResponses) ? (insurancePlanResponses[i] as any) : (insurancePlanResponse as any);
			if (plan && typeof plan === 'object') {
				const claimOfficeIdFromPlan = plan.claimOfficeId ?? plan.ClaimOfficeId;
				if (claimOfficeIdFromPlan !== undefined && pi.insuranceClaimOffice && typeof pi.insuranceClaimOffice === 'object') {
					pi.insuranceClaimOffice.claimOfficeId = claimOfficeIdFromPlan;
				}
			}
		}
		if (insArr.length) {
			(payload as any).caseInsurances = insArr;
		}
	} catch (e) {
		// ignore insurance mapping errors
	}

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
	dos?: string; // optional Date of Service (ISO string)
	timeoutMs?: number;
	logFn?: (entry: ApiLogEntry) => void;
	autoStampToday?: boolean;
	procedureAdjustments?: {
		primaryProcedureTfFirst?: boolean; // default false per latest UI example
		editableAll?: boolean; // make all procedures editable
		refreshDescriptions?: boolean; // sync modifiedProcedureDescription & procedureDisplayName from feeScheduleItem
	};
	// Backward-compatible single insurance mapping
	insuranceInsertResponse?: any;
	insurancePlanResponse?: any;
	// Preferred: multiple insurance mappings
	insuranceInsertResponses?: any[];
	insurancePlanResponses?: any[];
	facilityIdOverride?: number;
	insuranceType?: string;
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
 	dos,
	insuranceInsertResponse,
	insuranceInsertResponses,
	insurancePlanResponse,
	insurancePlanResponses,
	facilityIdOverride,
	insuranceType,
}: CreateCaseSummaryOptions) {
	if (!apiBaseUrl) throw new Error('apiBaseUrl is required');
	if (!token) throw new Error('token is required');
	const base = String(apiBaseUrl).replace(/\/$/, '');
	const template = loadCaseSummaryTemplate();
	const payload: ICaseSummary = caseSummary
		? merge<ICaseSummary>(template, caseSummary, { arrayMerge: mergeArraysPreferSource })
		: JSON.parse(JSON.stringify(template));
	applyCreatePatientResponse(payload, patientResponse);
	applyInsuranceMapping(payload, { insuranceInsertResponse, insuranceInsertResponses, insurancePlanResponse, insurancePlanResponses, facilityIdOverride, insuranceType });
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

	// Map Date of Service (dos) into payload if provided. Expect ISO date string (YYYY-MM-DD or full ISO).
	if (dos) {
		try {
			const rawDos = dos as string;
			// accept full ISO or YYYY-MM-DD
			let dosDate: Date | null = null;
			if (/^\d{4}-\d{2}-\d{2}$/.test(rawDos)) {
				dosDate = new Date(rawDos + 'T00:00:00Z');
			} else {
				const parsed = Date.parse(rawDos);
				if (!Number.isNaN(parsed)) dosDate = new Date(parsed);
			}
			if (dosDate) {
				// set payload.today to DOS ISO if DOS provided (matches template style)
				payload.today = dosDate.toISOString();
				// dateOfService in template is MM/DD/YYYY
				const mm = String(dosDate.getUTCMonth() + 1).padStart(2, '0');
				const dd = String(dosDate.getUTCDate()).padStart(2, '0');
				const yyyy = String(dosDate.getUTCFullYear());
				payload.dateOfService = `${mm}/${dd}/${yyyy}`;
				// procedureDt and procedureStartDt/procedureStopDt: if template has times, preserve time-of-day but replace date portion
				const replaceDatePortion = (orig: any, useStart = true) => {
					if (!orig) return null;
					try {
						const d = new Date(orig);
						if (Number.isNaN(d.getTime())) return null;
						// create a new Date with DOS date but preserve time components from orig
						const newD = new Date(Date.UTC(dosDate!.getUTCFullYear(), dosDate!.getUTCMonth(), dosDate!.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
						return newD.toISOString();
					} catch (e) { return null; }
				};
				// if payload has procedureStartDt/StopDt, replace date portion
				if (payload.procedureStartDt) {
					const ps = replaceDatePortion(payload.procedureStartDt, true);
					if (ps) payload.procedureStartDt = ps;
				}
				if (payload.procedureStopDt) {
					const pe = replaceDatePortion(payload.procedureStopDt, false);
					if (pe) payload.procedureStopDt = pe;
				}
				// procedureDt: usually full datetime — replace date portion
				if (payload.procedureDt) {
					const pd = replaceDatePortion(payload.procedureDt, true);
					if (pd) payload.procedureDt = pd;
				}
				// procedureStartTime/procedureStopTime in template are ISO strings — ensure they match start/stop
				if (payload.procedureStartDt) {
					try {
						const d = new Date(payload.procedureStartDt);
						payload.procedureStartTime = d.toISOString();
					} catch (e) {}
				}
				if (payload.procedureStopDt) {
					try {
						const d2 = new Date(payload.procedureStopDt);
						payload.procedureStopTime = d2.toISOString();
					} catch (e) {}
				}
			}
		} catch (e) {
			// ignore DOS mapping errors
		}
	}

	// apply CPT/FeeSchedule overrides to caseProcedures
	// Support either a single object or an array of feeScheduleOverride entries
	if (feeScheduleOverride && Array.isArray(payload.caseProcedures) && payload.caseProcedures.length) {
		const items = Array.isArray(feeScheduleOverride) ? feeScheduleOverride : [feeScheduleOverride];
		// If more fee schedules than existing procedures, clone the last procedure to create placeholders
		let procedures = payload.caseProcedures.slice();
		if (items.length > procedures.length) {
			const last = procedures[procedures.length - 1];
			for (let i = procedures.length; i < items.length; i++) {
				procedures.push(JSON.parse(JSON.stringify(last || {})));
			}
		}
		// map each fee schedule to corresponding procedure index
		procedures = procedures.map((cp: any, idx: number) => {
			const fsItem = items[idx];
			if (!fsItem) return cp; // leave unchanged if no mapping provided
			const updated = { ...cp };
			// direct CPT fields
			updated.cptCode = fsItem.cptProcedure?.cptCode ?? updated.cptCode;
			updated.procedureDescription = fsItem.procedure ?? updated.procedureDescription;
			updated.modifiedProcedureDescription = fsItem.modifiedProcedureDescription ?? `${fsItem.cptProcedure?.cptCode ?? ''}; ${fsItem.procedure}`.trim();
			updated.procedureDisplayName = fsItem.procedureDisplayName ?? `${fsItem.cptProcedure?.cptCode ?? ''}; ${fsItem.procedure}`.trim();
			// top-level feeSchedule references (keep in sync with nested feeScheduleItem)
			updated.feeScheduleId = fsItem.feeScheduleId ?? updated.feeScheduleId;
			updated.feeScheduleHistoryId = fsItem.feeScheduleHistoryId ?? updated.feeScheduleHistoryId ?? undefined;
			updated.feeScheduleRootId = fsItem.feeScheduleRootId ?? updated.feeScheduleRootId;
			// attach feeScheduleItem in expected structure
			updated.feeScheduleItem = {
				feeScheduleId: fsItem.feeScheduleId,
				procedure: fsItem.procedure,
				organizationId: fsItem.organizationId,
				cptProcedureId: fsItem.cptProcedureId,
				cptProcedure: fsItem.cptProcedure ? {
					cptProcedureId: fsItem.cptProcedure.cptProcedureId,
					cptCode: fsItem.cptProcedure.cptCode,
					cptDescription: fsItem.cptProcedure.cptDescription,
					isHcpcsCode: fsItem.cptProcedure.isHcpcsCode,
					isCdtCode: fsItem.cptProcedure.isCdtCode,
					isCustomCode: fsItem.cptProcedure.isCustomCode,
					sourceIdentifier: fsItem.cptProcedure.sourceIdentifier,
				} : undefined,
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
		payload.caseProcedures = procedures;
	}

	// no appointment type overrides here (reverted)
	if (autoStampToday && !dos) payload.today = new Date().toISOString();
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
	// Post the case summary (debug logs suppressed)
	const res = await postJson(url, payload, timeoutMs, buildHeaders(token), logFn);
	return res;
}

export default createCaseSummary;
