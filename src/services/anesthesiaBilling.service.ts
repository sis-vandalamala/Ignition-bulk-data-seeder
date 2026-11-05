import { getJson, postJson, describeApiError, type ApiLogEntry } from '../utils/api';
import { apiRoot, jsonHeaders } from './businessConfig';

// Anesthesia Billing desktop workflow (captured from the SIS app):
//   case created  -> Financial Clearance tracker (status Scheduled)
//   "Verification Complete" -> POST AnesthesiaBilling/InsuranceTracker/SaveBulkInsuranceVerification
//   Clinical Documentation  -> POST CDMDocument/{caseId} with caseStatus 10 (Performed) + anesthesia/operative times
//   -> case appears in the Coding/Charge Entry tracker (CasesToCodeTracker)
const DEPARTMENT_LOCK_TYPE = 16; // RecordLockType.Department_Information

// Insured vs self-pay is decided by the case's procedures (as the tracker does), not by whether the patient has
// an insurance record: verifying a self-pay case through the insured list moved it to "Removed".
export async function verifyAnesthesiaCase(apiBaseUrl: string, token: string, caseSummaryId: number, logFn?: (e: ApiLogEntry) => void) {
	let insured = false;
	try {
		const info: any = await getJson(`${apiRoot(apiBaseUrl)}/CaseSummary/GetCaseInformation/${caseSummaryId}/false`, 20000, { token, Accept: 'application/json' }, logFn);
		insured = Number(info && info.numberOfInsuranceProcedures) > 0;
	} catch (e) {
		throw new Error(`GetCaseInformation failed (needed to choose insured vs self-pay verification): ${describeApiError(e)}`);
	}
	const body = insured
		? { caseSummaryIds: [caseSummaryId], selfPayCaseSummaryIds: [] }
		: { caseSummaryIds: [], selfPayCaseSummaryIds: [caseSummaryId] };
	let res: any;
	try {
		res = await postJson(`${apiRoot(apiBaseUrl)}/AnesthesiaBilling/InsuranceTracker/SaveBulkInsuranceVerification`, body, 20000, jsonHeaders(token), logFn);
	} catch (e) {
		throw new Error(`SaveBulkInsuranceVerification failed: ${describeApiError(e)}`);
	}
	const ok = res && (Number(res.successful) > 0 || Number(res.alreadyCompleted) > 0);
	if (!ok) throw new Error(`Insurance verification was not completed for case ${caseSummaryId} (response: ${JSON.stringify(res)})`);
	return res;
}

export async function documentAnesthesiaCase(apiBaseUrl: string, token: string, caseSummaryId: number, organizationId: number | undefined, logFn?: (e: ApiLogEntry) => void) {
	const api = apiRoot(apiBaseUrl);
	const headers = jsonHeaders(token);
	let doc: any;
	try {
		doc = await getJson(`${api}/CDMDocument/${caseSummaryId}`, 20000, { token, Accept: 'application/json' }, logFn);
	} catch (e) {
		throw new Error(`GET CDMDocument failed: ${describeApiError(e)}`);
	}
	if (!doc || typeof doc !== 'object') throw new Error(`CDMDocument for case ${caseSummaryId} is empty`);
	const start = new Date(doc.dateOfService || Date.now());
	if (Number.isNaN(start.getTime())) throw new Error(`CDMDocument has an invalid dateOfService (${doc.dateOfService})`);
	const at = (min: number) => new Date(start.getTime() + min * 60000);
	const iso = (d: Date) => d.toISOString();
	const hhmm = (d: Date) => d.toISOString().slice(11, 16);
	// anesthesia 0..30 min, operative 5..25 min after the scheduled start
	const opStart = at(5), opEnd = at(25), anesEnd = at(30);
	doc.generalInfo = Object.assign({}, doc.generalInfo || {}, { caseStatus: 10 });
	doc.admitInfo = doc.admitInfo || { admitSource: '1; Non-Health Care Facility Point of Origin', admitType: '3; Elective', areaOfCareInformationId: -1 };
	doc.dischargeInfo = { dischargeStatus: 1, dischargeDate: iso(anesEnd), patientHandoffId: -1 };
	doc.areaOfCareTimes = [{
		sort: 5, moduleId: 1030, moduleName: 'Operative',
		beginTime: iso(opStart), endTime: iso(opEnd), caseStartTime: hhmm(opStart), caseEndTime: hhmm(opEnd),
		areaOfCareInformationId: -1, isDifferentDate: false, procedureAdditionalTimes: [],
		anesStartTime: iso(start), anesStopTime: iso(anesEnd),
	}];

	// the app holds a department lock on every case module while documenting
	let moduleIds: number[] = [];
	try {
		const mods: any = await getJson(`${api}/Module/GetModulesBycaseId/${caseSummaryId}/false?organisationId=${organizationId ?? ''}`, 20000, { token, Accept: 'application/json' }, logFn);
		moduleIds = Array.isArray(mods) ? mods.map((m: any) => Number(m.moduleId)).filter((n: number) => n > 0) : [];
	} catch (e) { moduleIds = []; }
	const locked: number[] = [];
	try {
		for (const moduleId of moduleIds) {
			const r = await postJson(`${api}/Security/RecordLock/RequestLock`, { caseSummaryId, recordLockTypeId: DEPARTMENT_LOCK_TYPE, moduleId }, 15000, headers, logFn);
			if (r) throw new Error(`Case ${caseSummaryId} module ${moduleId} is locked by ${r.staffName ? String(r.staffName).replace(/\s+/g, ' ').trim() : 'another user'}`);
			locked.push(moduleId);
		}
		try {
			return await postJson(`${api}/CDMDocument/${caseSummaryId}`, doc, 30000, headers, logFn);
		} catch (e) {
			throw new Error(`Save CDMDocument (Performed) failed: ${describeApiError(e)}`);
		}
	} finally {
		for (const moduleId of locked) {
			try { await postJson(`${api}/Security/RecordLock/ReleaseLock`, { caseSummaryId, recordLockTypeId: DEPARTMENT_LOCK_TYPE, moduleId }, 15000, headers, logFn); } catch (e) {}
		}
	}
}

export default { verifyAnesthesiaCase, documentAnesthesiaCase };

export async function getAnesthesiaCaseStatus(apiBaseUrl: string, token: string, caseSummaryId: number, logFn?: (e: ApiLogEntry) => void): Promise<string | undefined> {
	const info: any = await getJson(`${apiRoot(apiBaseUrl)}/CaseSummary/GetCaseInformation/${caseSummaryId}/false`, 20000, { token, Accept: 'application/json' }, logFn);
	return info && info.caseStatus ? String(info.caseStatus) : undefined;
}
