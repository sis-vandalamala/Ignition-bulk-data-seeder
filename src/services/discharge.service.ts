
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { postJson, getJson, ApiLogEntry } from '../utils/api';

// Helper to ensure /api prefix is present for discharge-related endpoints.
function apiPrefixed(base: string) {
	const trimmed = String(base).replace(/\/$/, '');
	return trimmed.endsWith('/api') ? trimmed : trimmed + '/api';
}

export async function getPhysicianNameAndID(apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/StaffList/GetStaffForFacility`;
	const headers: Record<string, string> = { token, 'Content-Type': 'application/json', Accept: 'application/json' } as any;
	// The original Java code used POST with empty body
	return await postJson(url, {}, 20000, headers, logFn);
}

export async function getStaffDetails(userName: string, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const staffResponse = await getPhysicianNameAndID(apiBaseUrl, token, logFn);
	// staffResponse is expected to be an array; find by lastName === userName
	try {
		if (Array.isArray(staffResponse)) {
			const staffDetails = staffResponse.find((s: any) => String(s.lastName) === String(userName));
			return { status: 200, staffDetails } as any;
		}
	} catch (e) {}
	return { status: 500, staffDetails: null } as any;
}

export async function getCaseDetailInformation(departmentName: string, patientId: number, caseSummaryId: number, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	if (!patientId || !caseSummaryId) return { status: 400, module: null } as any;
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/PatientFacesheet/GetCaseDetailInformation/${patientId}/${caseSummaryId}`;
	const headers: Record<string, string> = { token, Accept: 'application/json' } as any;
	try {
		const res = await getJson(url, 20000, headers, logFn);
		let modules: any[] = [];
		if (res) {
			if (Array.isArray(res.modules)) modules = res.modules;
			else if (Array.isArray(res)) modules = res;
			else if (res.modules && typeof res.modules === 'string') {
				try { modules = JSON.parse(res.modules); } catch (e) { modules = []; }
			}
		}
		const found = modules.find((m: any) => String(m.moduleName) === String(departmentName));
		return { status: 200, module: found ?? null } as any;
	} catch (err) {
		return { status: 500, module: null, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}

export async function runApisInOrder<T = any>(tasks: Array<() => Promise<T>>): Promise<void> {
	for (const task of tasks) {
		await task();
	}
}

export async function getPatientHandsOffData(caseSummaryId: any, moduleId: number | undefined, apiBaseUrl: string, token: string, logFn?: any) {
	try {
		const base = apiPrefixed(apiBaseUrl);
		const url = `${base}/patientHandOff/GetPatientHandsOffData?casesummaryId=${caseSummaryId}` + (moduleId ? `&moduleId=${moduleId}` : '');
		const headers: Record<string, string> = { token, Accept: 'application/json' } as any;
		const res = await getJson(url, 8000, headers, logFn);
		return { status: 200, raw: res };
	} catch (e) {
		return { status: 500, error: String(e) };
	}
}

export async function getFormByName(apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	try {
		const url = apiPrefixed(apiBaseUrl) + '/RecordHeader/Patient Panel/GetFormbyName';
		const res = await getJson(url, 20000, { token, Accept: 'application/json' } as any, logFn);
		if (!res) return { status: 500, formId: null, formName: null } as any;
		let parsed: any = res;
		if (typeof res === 'string') {
			try { parsed = JSON.parse(res); } catch (e) { parsed = null; }
		}
		if (!parsed) return { status: 500, formId: null, formName: null } as any;
		const formId = parsed.formId ?? parsed.FormId ?? null;
		const formName = parsed.formName ?? parsed.FormName ?? null;
		return { status: 200, formId, formName } as any;
	} catch (err) {
		return { status: 500, formId: null, formName: null, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}

export async function runDischargeFlow(userName?: string, apiBaseUrl?: string, token?: string, logFn?: (entry: ApiLogEntry) => void, patientId?: number, caseSummaryId?: number, orgId?: number): Promise<void> {
	userName = "sisadmin";
    if (!userName || !apiBaseUrl || !token) {
		try { console.log('[runDischargeFlow] skipped: missing required params', { userName: !!userName, apiBaseUrl: !!apiBaseUrl, token: !!token }); } catch (e) {}
		return;
	}
	try {
		const staff = await getStaffDetails(userName, apiBaseUrl, token, logFn);
		try { console.log('[getStaffDetails] result:', JSON.stringify(staff)); } catch (e) {}
		// Now fetch case detail information for the Recovery department if IDs provided
		let extractedModuleId: number | undefined = undefined;
		if (patientId && caseSummaryId) {
			const cd = await getCaseDetailInformation('Recovery', patientId, caseSummaryId, apiBaseUrl, token, logFn);
			try { console.log('[getCaseDetailInformation] result:', JSON.stringify(cd)); } catch (e) {}
			if (cd && cd.module) {
				extractedModuleId = Number(cd.module.moduleId ?? cd.module.moduleID ?? cd.module.moduleId);
			}
		}
		// If we didn't get a moduleId from case detail, try ModulesBycaseId endpoint
		if (!extractedModuleId && caseSummaryId) {
			try {
				const mod = await getModulesBycaseId(caseSummaryId, orgId, 'Recovery', apiBaseUrl, token, logFn);
				try { console.log('[getModulesBycaseId] result:', JSON.stringify(mod)); } catch (e) {}
				if (mod && mod.moduleId) extractedModuleId = Number(mod.moduleId);
			} catch (e) {
				try { console.log('[getModulesBycaseId] error:', String(e)); } catch (ee) {}
			}
		}
		// Fetch form by name (RecordHeader/Patient Panel/GetFormbyName)
		let extractedFormId: number | undefined = undefined;
		try {
			const form = await getFormByName(apiBaseUrl, token, logFn);
			try { console.log('[getFormByName] result:', JSON.stringify(form)); } catch (e) {}
			if (form && (form.formId || form.FormId)) extractedFormId = Number(form.formId ?? form.FormId);
		} catch (e) {
			try { console.log('[getFormByName] error:', String(e)); } catch (ee) {}
		}

		// Fetch form usage by form owner (requires moduleId, caseSummaryId, formId if available)
		try {
			if (extractedModuleId && caseSummaryId && extractedFormId) {
				const fu = await getFormUsageByFormOwner(extractedModuleId, caseSummaryId, extractedFormId, apiBaseUrl, token, logFn);
				try { console.log('[getFormUsageByFormOwner] result:', JSON.stringify(fu)); } catch (e) {}
				// If we got a formUsageId, attempt to update it with staff and timestamps
				try {
					const formUsageId = fu && (fu.formUsageId || fu.formUsageId === 0) ? fu.formUsageId : null;
					const staffIdVal = staff && staff.staffDetails ? (staff.staffDetails.staffId ?? staff.staffDetails.staffId) : undefined;
					const staffNameVal = staff && staff.staffDetails ? (staff.staffDetails.fullName ?? staff.staffDetails.fullName) : undefined;
					if (formUsageId && staffIdVal) {
						const lastUpdated = (new Date()).toISOString().slice(0,10) + 'T01:00:00.000';
						const upd = await updateFormUsageByFormOwner(formUsageId, caseSummaryId, extractedModuleId, extractedFormId, staffIdVal, staffNameVal, lastUpdated, apiBaseUrl, token, logFn);
						try { console.log('[updateFormUsageByFormOwner] result:', JSON.stringify(upd)); } catch (e) {}
					}
				} catch (e) {
					try { console.log('[updateFormUsageByFormOwner] error:', String(e)); } catch (ee) {}
				}
			}
		} catch (e) {
			try { console.log('[getFormUsageByFormOwner] error:', String(e)); } catch (ee) {}
		}

			// Fetch area care informations by case
			try {
				if (patientId && caseSummaryId) {
					const ac = await getAreaCareInformationsByCase(patientId, caseSummaryId, apiBaseUrl, token, logFn);
					try { console.log('[getAreaCareInformationsByCase] result:', JSON.stringify(ac)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[getAreaCareInformationsByCase] error:', String(e)); } catch (ee) {}
			}
			// Update CaseSummary status to 0 (discharged) if we have a caseSummaryId
			try {
				if (caseSummaryId) {
					const csu = await caseSummaryUpdateCaseStatus(caseSummaryId, 0, apiBaseUrl, token, logFn);
					try { console.log('[caseSummaryUpdateCaseStatus] result:', JSON.stringify(csu)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[caseSummaryUpdateCaseStatus] error:', String(e)); } catch (ee) {}
			}
			// After updating case status, request a record lock for the module (if available)
			try {
				if (caseSummaryId && extractedModuleId) {
					const lockRes = await requestLock(caseSummaryId, extractedModuleId as number, apiBaseUrl, token, logFn);
					try { console.log('[requestLock] result:', JSON.stringify(lockRes)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[requestLock] error:', String(e)); } catch (ee) {}
			}
			// Also call the Java-style area-care-by-case function for department 'Recovery'
			try {
				if (patientId && caseSummaryId && extractedModuleId) {
					const acDept = await getAreaCareInformationsByCaseForDepartment('Recovery', patientId, caseSummaryId, extractedModuleId as number, apiBaseUrl, token, logFn);
					try { console.log('[getAreaCareInformationsByCaseForDepartment] result:', JSON.stringify(acDept)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[getAreaCareInformationsByCaseForDepartment] error:', String(e)); } catch (ee) {}
			}
			// Insert a new AreaOfCareInformation record (use today's date/time if not provided)
			try {
				if (patientId && caseSummaryId && extractedModuleId) {
					const insertRes = await insertAreaOfCareInformation(undefined, caseSummaryId, extractedModuleId as number, patientId, apiBaseUrl, token, logFn);
					try { console.log('[insertAreaOfCareInformation] result:', JSON.stringify(insertRes)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[insertAreaOfCareInformation] error:', String(e)); } catch (ee) {}
			}
			// Save area of care staff details
			try {
				if (patientId && caseSummaryId && extractedModuleId && staff && staff.staffDetails) {
					const staffIdVal = staff.staffDetails.staffId ?? staff.staffDetails.staffId;
					const staffRoleId = (staff.staffDetails.roleId ?? 0) as number;
					const saveRes = await saveAreaOfCareStaffDetails(staffIdVal, staffRoleId, caseSummaryId, extractedModuleId as number, apiBaseUrl, token, logFn);
					try { console.log('[saveAreaOfCareStaffDetails] result:', JSON.stringify(saveRes)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[saveAreaOfCareStaffDetails] error:', String(e)); } catch (ee) {}
			}
			// Re-run Java-style GetAreaCareInformationsbyCaseForDepartment (department 'Recovery') after saving staff
			try {
				if (patientId && caseSummaryId && extractedModuleId) {
					const acAfter = await getAreaCareInformationsByCaseForDepartment('Recovery', patientId, caseSummaryId, extractedModuleId as number, apiBaseUrl, token, logFn);
					try { console.log('[getAreaCareInformationsByCaseForDepartment after save] result:', JSON.stringify(acAfter)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[getAreaCareInformationsByCaseForDepartment after save] error:', String(e)); } catch (ee) {}
			}
            // Get Patient HandsOff Data (first call)
			try {
				if (caseSummaryId && extractedModuleId) {
					const ph = await getPatientHandsOffData(caseSummaryId, extractedModuleId as number, apiBaseUrl, token, logFn);
					try { console.log('[getPatientHandsOffData] result:', JSON.stringify(ph)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[getPatientHandsOffData] error:', String(e)); } catch (ee) {}
			}
            // Get Patient HandsOff Data (second call, after area-of-care save)
			try {
				if (caseSummaryId && extractedModuleId) {
					const ph2 = await getPatientHandsOffData(caseSummaryId, extractedModuleId as number, apiBaseUrl, token, logFn);
					try { console.log('[getPatientHandsOffData after save] result:', JSON.stringify(ph2)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[getPatientHandsOffData after save] error:', String(e)); } catch (ee) {}
			}
			// Insert Patient HandOff Data (call once after getPatientHandsOffData)
			try {
				if (caseSummaryId && extractedModuleId) {
					const phIns = await insertPatientHandOffData(4, 0, null, caseSummaryId, extractedModuleId as number, apiBaseUrl, token, logFn);
					try { console.log('[insertPatientHandOffData] result:', JSON.stringify(phIns)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[insertPatientHandOffData] error:', String(e)); } catch (ee) {}
			}
			// Save area of care staff details again immediately after patient handoff
			try {
				if (patientId && caseSummaryId && extractedModuleId && staff && staff.staffDetails) {
					const staffIdVal = staff.staffDetails.staffId ?? staff.staffDetails.staffId;
					const staffRoleId = (staff.staffDetails.roleId ?? 0) as number;
					const saveRes2 = await saveAreaOfCareStaffDetails(staffIdVal, staffRoleId, caseSummaryId, extractedModuleId as number, apiBaseUrl, token, logFn);
					try { console.log('[saveAreaOfCareStaffDetails after handoff] result:', JSON.stringify(saveRes2)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[saveAreaOfCareStaffDetails after handoff] error:', String(e)); } catch (ee) {}
			}
			// Insert Patient HandOff Data with caseStatus 10 (call next)
			try {
				if (caseSummaryId && extractedModuleId) {
					const phIns10 = await insertPatientHandOffData(10, 10, null, caseSummaryId, extractedModuleId as number, apiBaseUrl, token, logFn);
					try { console.log('[insertPatientHandOffData(10,10,null)] result:', JSON.stringify(phIns10)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[insertPatientHandOffData(10,10,null)] error:', String(e)); } catch (ee) {}
			}
			// Save area of care staff details again after the second patient handoff
			try {
				if (patientId && caseSummaryId && extractedModuleId && staff && staff.staffDetails) {
					const staffIdVal = staff.staffDetails.staffId ?? staff.staffDetails.staffId;
					const staffRoleId = (staff.staffDetails.roleId ?? 0) as number;
					const saveRes3 = await saveAreaOfCareStaffDetails(staffIdVal, staffRoleId, caseSummaryId, extractedModuleId as number, apiBaseUrl, token, logFn);
					try { console.log('[saveAreaOfCareStaffDetails after second handoff] result:', JSON.stringify(saveRes3)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[saveAreaOfCareStaffDetails after second handoff] error:', String(e)); } catch (ee) {}
			}
			// Request record lock again after the second handoff and save
			try {
				if (caseSummaryId && extractedModuleId) {
					const lockRes2 = await requestLock(caseSummaryId, extractedModuleId as number, apiBaseUrl, token, logFn);
					try { console.log('[requestLock after second handoff] result:', JSON.stringify(lockRes2)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[requestLock after second handoff] error:', String(e)); } catch (ee) {}
			}
			// Upsert CaseSummary information (status updates etc.)
			try {
				if (caseSummaryId) {
					const upsertRes = await upsertCaseSummaryInfo(caseSummaryId, undefined, apiBaseUrl, token, logFn);
					try { console.log('[upsertCaseSummaryInfo] result:', JSON.stringify(upsertRes)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[upsertCaseSummaryInfo] error:', String(e)); } catch (ee) {}
			}
			// Release record lock for department 'Recovery'
			try {
				if (caseSummaryId) {
					const relRes = await releaseLockPatient('Recovery', caseSummaryId, apiBaseUrl, token, orgId, logFn);
					try { console.log('[releaseLockPatient] result:', JSON.stringify(relRes)); } catch (e) {}
				}
			} catch (e) {
				try { console.log('[releaseLockPatient] error:', String(e)); } catch (ee) {}
			}

		// Additional ordered APIs can be placed here
	} catch (e) {
		try { console.log('[runDischargeFlow] error:', String(e)); } catch (ee) {}
	}
}

export async function getFormUsageByFormOwner(moduleId: number, caseSummaryId: number, formId: number, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/FormUsage/GetFormUsagebyByFormOwner`;
	const headers: Record<string, string> = { token, 'Content-Type': 'application/json', Accept: 'application/json' } as any;
	// Load request template and update fields
	const tplPath = path.join(__dirname, '..', 'reqTemplates', 'GetFormUsagebyByFormOwner.json');
	let payload: any = { caseSummaryId, moduleId, formId };
	try {
		const raw = fs.readFileSync(tplPath, 'utf8');
		const parsed = JSON.parse(raw);
		parsed.caseSummaryId = caseSummaryId;
		parsed.moduleId = moduleId;
		parsed.formId = formId;
		payload = parsed;
	} catch (e) {
		// fallback to minimal payload if template load fails
		payload = { caseSummaryId, moduleId, formId };
	}
	try {
		const res = await postJson(url, payload, 20000, headers, logFn);
		let formUsageId: any = null;
		if (res) {
			formUsageId = (res as any).formId ?? (res as any).formUsageId ?? null;
		}
		return { status: 200, formUsageId, raw: res } as any;
	} catch (err) {
		return { status: 500, formUsageId: null, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}

export async function updateFormUsageByFormOwner(formUsageId: number, caseSummaryId: number, moduleId: number, formId: number, staffId: number | string, staffName: string | undefined, lastUpdated: string, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/FormUsage/UpdateFormUsageByFormOwner`;
	const headers: Record<string, string> = { token, 'Content-Type': 'application/json', Accept: 'application/json' } as any;
	const tplPath = path.join(__dirname, '..', 'reqTemplates', 'updateFormUsagebyByFormOwner.json');
	let payload: any = { formUsageId, caseSummaryId, moduleId, formId, staffId, staffName, lastUpdated };
	try {
		const raw = fs.readFileSync(tplPath, 'utf8');
		const parsed = JSON.parse(raw);
		parsed.formUsageId = formUsageId;
		parsed.caseSummaryId = caseSummaryId;
		parsed.moduleId = moduleId;
		parsed.formId = formId;
		parsed.staffId = staffId;
		parsed.staffName = staffName;
		parsed.lastUpdated = lastUpdated;
		payload = parsed;
	} catch (e) {
		payload = { formUsageId, caseSummaryId, moduleId, formId, staffId, staffName, lastUpdated };
	}
	try {
		const res = await postJson(url, payload, 20000, headers, logFn);
		return { status: 200, raw: res } as any;
	} catch (err) {
		return { status: 500, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}

export async function getAreaCareInformationsByCase(patientId: number, caseSummaryId: number, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/AreaCareInformation/GetAreaCareInformationsbyCase`;
	const headers: Record<string, string> = { token, 'Content-Type': 'application/json', Accept: 'application/json' } as any;
	const payload = { casesummaryId: caseSummaryId, patientId: patientId };
	try {
		const res = await postJson(url, payload, 20000, headers, logFn);
		// Expect an array response; take first element's areaOfCareInformationId
		let areaId: any = null;
		if (res && Array.isArray(res) && res.length) {
			areaId = res[0].areaOfCareInformationId ?? res[0].areaofCareInformationId ?? null;
		}
		return { status: 200, areaOfCareInformationId: areaId, raw: res } as any;
	} catch (err) {
		return { status: 500, areaOfCareInformationId: null, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}

export async function getModulesBycaseId(caseSummaryId: number, orgId: number | undefined, departmentName: string, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const rel = `${caseSummaryId}/undefined${orgId ? ('?organisationId=' + orgId) : ''}`;
	const url = `${base}/Module/GetModulesBycaseId/${rel}`;
	const headers: Record<string, string> = { token, Accept: 'application/json' } as any;
	try {
		const res = await getJson(url, 20000, headers, logFn);
		// Expect an array of modules
		let arr: any[] = [];
		if (Array.isArray(res)) arr = res;
		else if (res && Array.isArray(res.modules)) arr = res.modules;
		else if (typeof res === 'string') {
			try { arr = JSON.parse(res); } catch (e) { arr = []; }
		}
		const found = arr.find((m: any) => String(m.moduleName) === String(departmentName));
		return { status: 200, moduleId: found ? (found.moduleId ?? found.moduleID ?? found.id) : null, module: found } as any;
	} catch (err) {
		return { status: 500, moduleId: null, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}

export async function caseSummaryUpdateCaseStatus(caseSummaryId: number, caseStatus: number, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/CaseSummary/UpdateCaseSatus/${caseSummaryId}`;
	const headers: Record<string, string> = { token, 'Content-Type': 'application/json', Accept: 'application/json' } as any;
	// The Java original sent "0" as body and logged that format is TBD. We'll send a simple JSON payload { caseStatus }
	const payload = { caseStatus };
	try {
		const res = await postJson(url, payload, 20000, headers, logFn);
		return { status: 200, raw: res } as any;
	} catch (err) {
		return { status: 500, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}

export async function requestLock(caseSummaryId: number, moduleId: number, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/Security/RecordLock/RequestLock`;
	const headers: Record<string, string> = { token, 'Content-Type': 'application/json', Accept: 'application/json' } as any;
	const payload = { casesummaryId: caseSummaryId, RecordLockTypeId: 16, moduleId };
	try {
		const res = await postJson(url, payload, 20000, headers, logFn);
		return { status: 200, raw: res } as any;
	} catch (err) {
		return { status: 500, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}

export async function getAreaCareInformationsByCaseForDepartment(departmentName: string, patientId: number, caseSummaryId: number, moduleId: number, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/AreaCareInformation/GetAreaCareInformationsbyCase`;
	const headers: Record<string, string> = { token, 'Content-Type': 'application/json', Accept: 'application/json' } as any;
	const payload = { casesummaryId: caseSummaryId, patientId: patientId, moduleId: moduleId } as any;
	try {
		const res = await postJson(url, payload, 20000, headers, logFn);
		// If non-empty response, extract first area's areaOfCareInformationId
		let areaId: any = null;
		if (res && typeof res === 'string' && res !== '' && res !== '[]') {
			try {
				const parsed = JSON.parse(res);
				if (Array.isArray(parsed) && parsed.length) {
					areaId = parsed[0].areaOfCareInformationId ?? parsed[0].areaofCareInformationId ?? null;
				}
			} catch (e) {
				// fallback: try to access as object
				try {
					if (Array.isArray(res) && res.length) areaId = res[0].areaOfCareInformationId ?? res[0].areaofCareInformationId ?? null;
				} catch (ee) {}
			}
		} else if (res && Array.isArray(res) && res.length) {
			areaId = res[0].areaOfCareInformationId ?? res[0].areaofCareInformationId ?? null;
		}
		return { status: 200, areaOfCareInformationId: areaId, raw: res } as any;
	} catch (err) {
		return { status: 500, areaOfCareInformationId: null, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}

export async function insertAreaOfCareInformation(procedureDt: string | undefined, caseSummaryId: number, moduleId: number, patientId: number, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/AreaCareInformation/InsertAreaCareInformation`;
	const headers: Record<string, string> = { token, 'Content-Type': 'application/json', Accept: 'application/json' } as any;
	// Load template if present
	const tplPath = path.join(__dirname, '..', 'reqTemplates', 'InsertAreaOfCareInformation.json');
	let payload: any = {};
	try {
		const raw = fs.readFileSync(tplPath, 'utf8');
		payload = JSON.parse(raw);
		// update common fields
		payload.caseSummaryId = caseSummaryId;
		payload.moduleId = moduleId;
		payload.patientId = patientId;
	} catch (e) {
		payload = { caseSummaryId, moduleId, patientId } as any;
	}
	// set admissionTime using procedureDt or now
	try {
		const now = new Date();
		const datePart = procedureDt ? String(procedureDt) : now.toISOString().slice(0,10);
		const timePart = now.toTimeString().slice(0,8);
		payload.admissionTime = `${datePart}T${timePart}+05:30`;
	} catch (e) {}
	try {
		const res = await postJson(url, payload, 20000, headers, logFn);
		return { status: 200, raw: res } as any;
	} catch (err) {
		return { status: 500, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}

export async function saveAreaOfCareStaffDetails(staffId: number | string, staffRoleId: number, caseSummaryId: number, moduleId: number, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/AreaOfCareStaffEntry/SaveAreaOfCareStaffDetails`;
	const headers: Record<string, string> = { token, 'Content-Type': 'application/json', Accept: 'application/json' } as any;
	const tplPath = path.join(__dirname, '..', 'reqTemplates', 'SaveAreaOfCareStaffDetails.json');
	let payload: any = {};
	try {
		const raw = fs.readFileSync(tplPath, 'utf8');
		payload = JSON.parse(raw);
		// inject fields
		// support nested path areaofCareStaffEntryDetails[0].staffId
		if (payload.areaofCareStaffEntryDetails && Array.isArray(payload.areaofCareStaffEntryDetails) && payload.areaofCareStaffEntryDetails.length) {
			payload.areaofCareStaffEntryDetails[0].staffId = Number(staffId);
			payload.areaofCareStaffEntryDetails[0].staffRoleId = Number(staffRoleId);
			payload.areaofCareStaffEntryDetails[0].inTimeDt = (new Date()).toISOString().slice(0,10) + 'T' + (new Date()).toTimeString().slice(0,5) + ':00+05:30';
		}
		payload.caseSummaryId = caseSummaryId;
		payload.moduleId = moduleId;
	} catch (e) {
		payload = {
			areaofCareStaffEntryDetails: [{ staffId: Number(staffId), staffRoleId: Number(staffRoleId), inTimeDt: (new Date()).toISOString().slice(0,10) + 'T' + (new Date()).toTimeString().slice(0,5) + ':00+05:30' }],
			caseSummaryId,
			moduleId
		} as any;
	}
	try {
		const res = await postJson(url, payload, 20000, headers, logFn);
		return { status: 200, raw: res } as any;
	} catch (err) {
		return { status: 500, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}

export async function insertPatientHandOffData(caseStatus: number, defaultCaseStatusId: number, discharged_To_Value: string | null, caseSummaryId: number, moduleId: number | undefined, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/patientHandOff/InsertPatientHandOffData`;
	const headers: Record<string, string> = { token, 'Content-Type': 'application/json', Accept: 'application/json' } as any;

	// Try template first, otherwise use current patient handoff data as a base
	const tplPath = path.join(__dirname, '..', 'reqTemplates', 'InsertPatientHandOffData.json');
	let payload: any = {};
	try {
		const raw = fs.readFileSync(tplPath, 'utf8');
		payload = JSON.parse(raw);
	} catch (e) {
		try {
			const ph = await getPatientHandsOffData(caseSummaryId, moduleId, apiBaseUrl, token, logFn);
			if (ph && ph.raw) payload = typeof ph.raw === 'string' ? JSON.parse(ph.raw) : JSON.parse(JSON.stringify(ph.raw));
		} catch (e2) {
			payload = {};
		}
	}

	try {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const yyyyMMdd = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
		const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
		const transfertime = `${yyyyMMdd}T${hhmm}:00+05:30`;
		const transferTimeOF_Time = `${pad(now.getMonth()+1)}-${pad(now.getDate())}-${now.getFullYear()} ${hhmm}`;

		payload = payload || {};
		payload.transferTime = transfertime;
		payload.transferredById = null;
		payload.dischargedOnDt = transfertime;
		payload.transferTimeOF_Time = transferTimeOF_Time;
		payload.caseStatus = caseStatus;
		payload.defaultCaseStatusId = defaultCaseStatusId;
		payload.dischargeNormalTf = true;
		if (caseStatus !== 4 && discharged_To_Value) {
			payload.discharged_To_Value = discharged_To_Value;
			payload.dischargedToLocationId = null;
		}
	} catch (e) {
		// ignore
	}

	try {
		const res = await postJson(url, payload, 20000, headers, logFn);
		return { status: 200, raw: res } as any;
	} catch (err) {
		return { status: 500, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}

export async function upsertCaseSummaryInfo(caseSummaryId: number, appointmentId: number | undefined, apiBaseUrl: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/CaseSummary/UpsertCaseSummaryInfo`;
	const headers: Record<string, string> = { token, 'Content-Type': 'application/json', Accept: 'application/json' } as any;

	const tplPath = path.join(__dirname, '..', 'reqTemplates', 'UpsertCaseSummaryInfo.json');
	let payload: any = {};
	try {
		const raw = fs.readFileSync(tplPath, 'utf8');
		payload = JSON.parse(raw);
	} catch (e) {
		payload = {};
	}
	// Inject/override core fields (ensure both camelCase and PascalCase variants just in case API expects one)
	const nowIso = (new Date()).toISOString();
	payload.caseSummaryId = caseSummaryId;
	payload.CaseSummaryId = caseSummaryId;
	payload.acuteChronicTf = payload.acuteChronicTf ?? true;
	payload.created = payload.created ?? nowIso;
	payload.status = 10;
	payload.statusAtDischarge = 10;
	payload.previousStatus = payload.previousStatus ?? '04';
	payload.appointmentId = appointmentId ?? 321;

	try {
		const res = await axios.put(url, payload, { headers, timeout: 20000 });
		return { status: 200, raw: res.data } as any;
	} catch (err: any) {
		let detail: any = null;
		try { detail = err.response ? err.response.data : null; } catch (_) {}
		try { console.log('[upsertCaseSummaryInfo] error detail:', JSON.stringify({ message: err.message, response: detail, payload })); } catch (_) {}
		return { status: 500, error: err.message, response: detail, sentPayload: payload } as any;
	}
}

export async function releaseLockPatient(departmentName: string, caseSummaryId: number, apiBaseUrl: string, token: string, orgId?: number, logFn?: (entry: ApiLogEntry) => void) {
	const base = apiPrefixed(apiBaseUrl);
	const url = `${base}/Security/RecordLock/ReleaseLock`;
	const headers: Record<string, string> = { token, 'Content-Type': 'application/json', Accept: 'application/json' } as any;

	try {
		// Resolve module id via getModulesBycaseId helper
		const mod = await getModulesBycaseId(caseSummaryId, orgId, departmentName, apiBaseUrl, token, logFn);
		const moduleId = mod && (mod.moduleId ?? mod.moduleId) ? Number(mod.moduleId) : null;
		if (!moduleId) return { status: 400, error: 'moduleId not found' } as any;

		const payload = { CaseSummaryId: caseSummaryId, RecordLockTypeId: 16, moduleId } as any;
		const res = await postJson(url, payload, 20000, headers, logFn);
		return { status: 200, raw: res } as any;
	} catch (err) {
		return { status: 500, error: (err as any) && (err as any).message ? (err as any).message : String(err) } as any;
	}
}