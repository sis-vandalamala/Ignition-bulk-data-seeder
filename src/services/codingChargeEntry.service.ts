import path from 'path';
import fs from 'fs';
import { getJson, postJson, ApiLogEntry } from '../utils/api';
import axios from 'axios';

const DEFAULT_DIAG_CODE = 'H44.001';

export type ChargeEntryPeriodBatch = {
  periodId: number;
  periodName: string;
  batchId: number;
  batchDescription: string;
};

export type PerformCasesToCodeOptions = {
  chargeEntry?: boolean;
  cptAmounts?: Record<string, number>;
  feeScheduleOverride?: any[];
  periodBatchOverride?: ChargeEntryPeriodBatch;
};

type PerformPatientChargeEntryOptions = {
  amount?: string | number;
  token?: string;
  logFn?: (entry: ApiLogEntry) => void;
  periodBatch?: ChargeEntryPeriodBatch;
  caseSummaryId?: string | number;
};

function apiBase(base: string) {
  return String(base).replace(/\/$/, '') + '/api';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractPerformedProcedures(resp: any): any[] {
  if (!resp) return [];
  const visited = new Set<any>();
  const stack: any[] = [resp];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray((current as any).performedItems) && (current as any).performedItems.length) {
      return (current as any).performedItems as any[];
    }
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    const values = Object.values(current);
    for (const value of values) {
      if (value && (typeof value === 'object')) stack.push(value);
    }
  }
  return [];
}

async function fetchScheduledProceduresWithRetry(apiBaseUrl: string, caseSummaryId: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
  const maxAttempts = 5;
  const delayMs = 750;
  let last: any = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const scheduled = await getScheduledProcedures(apiBaseUrl, caseSummaryId, token, logFn);
    last = scheduled;
    if (Array.isArray(scheduled) && scheduled.length > 0) return scheduled;
    if (attempt < maxAttempts) await sleep(delayMs);
  }
  return last;
}

export async function getScheduledProcedures(apiBaseUrl: string, caseSummaryId: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
  const base = apiBase(apiBaseUrl);
  const rel = `/ScheduledCaseProcedure/GetScheduledProcedures/${caseSummaryId}/false`;
  const url = base + rel;
  return await getJson(url, 20000, { token, Accept: 'application/json' }, logFn);
}

export async function getICDCode(apiBaseUrl: string, icdCode: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
  const base = apiBase(apiBaseUrl);
  const rel = `/ICDCodeClassification/GetICDCodeClassifications`;
  const url = base + rel;
  // API expects a quoted string body like "H44"
  const body = '"' + (icdCode || DEFAULT_DIAG_CODE).substring(0, 3) + '"';
  return await postJson(url, body, 20000, { 'Content-Type': 'application/json', token }, logFn);
}


export async function performPatientCasesToCode(apiBaseUrl: string, caseSummaryId: string, token: string, logFn?: (entry: ApiLogEntry) => void, options?: PerformCasesToCodeOptions) {
  const diagnosisCode = DEFAULT_DIAG_CODE;
  // load template
  const tplPath = path.join(__dirname, '..', 'reqTemplates', 'CasesToCodeRequest.json');
  let tpl: any = {};
  try { tpl = JSON.parse(fs.readFileSync(tplPath, 'utf8')); } catch (e) { tpl = { performedItems: [], deletedPerformedItems: [] }; }

  const scheduled = await fetchScheduledProceduresWithRetry(apiBaseUrl, caseSummaryId, token, logFn);
  const icdRes = await getICDCode(apiBaseUrl, diagnosisCode, token, logFn);
  // icdRes may be array; find diagnosis object matching quickCode
  let diagnosisObj: any = null;
  try {
    const arr = Array.isArray(icdRes) ? icdRes : JSON.parse(String(icdRes || '[]'));
    diagnosisObj = arr.find((d: any) => String(d.icdCode) === diagnosisCode) || arr[0] || null;
  } catch (e) { diagnosisObj = null; }

  const performedTemplate = (tpl.performedItems && tpl.performedItems[0]) ? tpl.performedItems[0] : {};
  const performedItems: any[] = [];
  const deletedPerformedItems: any[] = [];

  if (Array.isArray(scheduled)) {
    for (let i = 0; i < scheduled.length; i++) {
      const sp = scheduled[i];
      const item = JSON.parse(JSON.stringify(performedTemplate));
      // map fields similar to Java logic
      item.units = 1;
      item.caseSummaryId = Number(sp.caseSummaryId ?? caseSummaryId);
      item.providerId = Number(sp.physicianId ?? sp.providerId ?? null);
      item.cptProcedureId = Number(sp.cptProcedureId ?? null);
      item.feeScheduleItem = sp.feeScheduleItem ?? item.feeScheduleItem ?? {};
      item.sortorder = i;
      item.feeScheduleId = Number(sp.feeScheduleId ?? null);
      item.caseProcedureId = Number(sp.caseProcedureId ?? null);
      item.cptCode = sp.cptCode ?? item.cptCode;
      item.cptProcedureDescription = sp.cptDescription ?? item.cptProcedureDescription;
      item.physicianName = sp.physicianName ?? item.physicianName;
      // diagnosis mapping
      if (diagnosisObj) {
        item.diagnosisList = item.diagnosisList || [];
        item.diagnosisList[0] = item.diagnosisList[0] || { dictionaryItem: {}, diagnosisId: null, sortOrder: 0 };
        item.diagnosisList[0].dictionaryItem = item.diagnosisList[0].dictionaryItem || {};
        item.diagnosisList[0].dictionaryItem.id = diagnosisObj.icdCodeId ?? diagnosisObj.id ?? item.diagnosisList[0].dictionaryItem.id;
        item.diagnosisList[0].dictionaryItem.quickCode = diagnosisObj.icdCode ?? diagnosisObj.quickCode ?? diagnosisObj.icdCode;
        item.diagnosisList[0].dictionaryItem.value = diagnosisObj.icdCodeDescription ?? diagnosisObj.value ?? diagnosisObj.description;
        item.diagnosisList[0].diagnosisId = diagnosisObj.icdCodeId ?? diagnosisObj.id ?? null;
      }
      performedItems.push(item);
    }
  }

  const casesToCode = { performedItems, deletedPerformedItems };
  const resp = await performCasesToCode(apiBaseUrl, casesToCode, token, logFn);
  // Update case status to '11' and upsert case summary info (currentStatus='11', previousStatus='10') -- run BEFORE charge entry
  try {
    await updateCaseStatus(apiBaseUrl, caseSummaryId, '11', token, logFn);
  } catch (e) {
    try { if (logFn) logFn({ url: 'updateCaseStatus', method: 'POST', status: 'error', error: String(e), timestamp: new Date().toISOString() } as any); } catch (ee) {}
  }
  
  try {
    await upsertCaseSummaryInfo(apiBaseUrl, caseSummaryId, '11', '10', token, logFn);
  } catch (e) {
    try { if (logFn) logFn({ url: 'upsertCaseSummaryInfo', method: 'PUT', status: 'error', error: String(e), timestamp: new Date().toISOString() } as any); } catch (ee) {}
  }

  // Parse response to object if needed, then perform charge entry
  let respObj: any = resp;
  try {
    if (typeof resp === 'string') respObj = resp ? JSON.parse(resp) : resp;
  } catch (e) {
    // suppressed console output
  }
  if (!respObj || typeof respObj !== 'object') respObj = {};
  if (!respObj.result || typeof respObj.result !== 'object') respObj.result = {};
  if (!Array.isArray(respObj.result.performedItems) || !respObj.result.performedItems.length) {
    respObj.result.performedItems = performedItems;
  }

  const doChargeEntry = options && Object.prototype.hasOwnProperty.call(options, 'chargeEntry') ? !!options.chargeEntry : true;
  if (doChargeEntry) {
    try {
      // suppressed console output
      // augment response object with UI-provided amounts for charge wiring
      try {
        if (options && options.cptAmounts) {
          respObj.cptAmounts = options.cptAmounts;
        }
        if (options && options.feeScheduleOverride) {
          respObj.feeScheduleOverride = options.feeScheduleOverride;
        }
      } catch (e) {}
      const chargeResult = await performPatientChargeEntry(apiBaseUrl, respObj, {
        amount: '200',
        token,
        logFn,
        periodBatch: options?.periodBatchOverride,
        caseSummaryId,
      });
      try { if (logFn) logFn({ url: 'performPatientChargeEntry', method: 'POST', status: 'ok', timestamp: new Date().toISOString(), durationMs: 0 } as any); } catch (e) {}
    } catch (e) {
      try { if (logFn) logFn({ url: 'performPatientChargeEntry', method: 'POST', status: 'error', error: String(e), timestamp: new Date().toISOString() } as any); } catch (ee) {}
    }
  } else {
    // suppressed console output for skipped charge entry
  }
}

export async function updateCaseStatus(apiBaseUrl: string, caseSummaryId: string, caseStatus: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
  const base = apiBase(apiBaseUrl);
  const rel = `/CaseSummary/UpdateCaseSatus/${caseSummaryId}`;
  const url = base + rel;
  try {
    const res = await postJson(url, caseStatus, 20000, { 'Content-Type': 'application/json', token }, logFn);
    try { if (logFn) logFn({ url, method: 'POST', status: 200, timestamp: new Date().toISOString() } as any); } catch (e) {}
    return res;
  } catch (err: any) {
    try { if (logFn) logFn({ url, method: 'POST', status: 'error', error: err.message, timestamp: new Date().toISOString() } as any); } catch (e) {}
    throw err;
  }
}

export async function upsertCaseSummaryInfo(apiBaseUrl: string, caseSummaryId: string, currentStatus: string, previousStatus: string, token: string, logFn?: (entry: ApiLogEntry) => void) {
  const base = apiBase(apiBaseUrl);
  const rel = `/CaseSummary/UpsertCaseSummaryInfo`;
  const url = base + rel;
  const tplPath = path.join(__dirname, '..', 'reqTemplates', 'UpsertCaseSummaryInfo.json');
  let payload: any = {};
  try {
    const raw = fs.readFileSync(tplPath, 'utf8');
    payload = JSON.parse(raw);
  } catch (e) {
    payload = {};
  }
  const now = (new Date()).toISOString();
  payload.caseSummaryId = Number(caseSummaryId);
  payload.CaseSummaryId = Number(caseSummaryId);
  payload.acuteChronicTf = payload.acuteChronicTf ?? true;
  payload.created = payload.created ?? now;
  payload.status = currentStatus;
  payload.statusAtDischarge = 10;
  payload.previousStatus = previousStatus;
  payload.appointmentId = payload.appointmentId ?? 321;

  try {
    const res = await axios.put(url, payload, { headers: { 'Content-Type': 'application/json', token }, timeout: 20000 });
    try { if (logFn) logFn({ url, method: 'PUT', status: res.status, timestamp: new Date().toISOString() } as any); } catch (e) {}
    return res.data;
  } catch (err: any) {
    try { if (logFn) logFn({ url, method: 'PUT', status: 'error', error: err.message, timestamp: new Date().toISOString() } as any); } catch (e) {}
    throw err;
  }
}

export async function performCasesToCode(apiBaseUrl: string, casesToCodeRequest: any, token: string, logFn?: (entry: ApiLogEntry) => void) {
  const base = apiBase(apiBaseUrl);
  const rel = `/CaseToCode/SavePerformedItems`;
  const url = base + rel;
  try {
    const res = await postJson(url, casesToCodeRequest, 20000, { 'Content-Type': 'application/json', token }, logFn);
    // Map response as string for parity with Java
    try { if (logFn) logFn({ url, method: 'POST', status: 200, timestamp: new Date().toISOString() } as any); } catch (e) {}
    return res;
  } catch (err: any) {
    try { if (logFn) logFn({ url, method: 'POST', status: 'error', error: err.message, timestamp: new Date().toISOString() } as any); } catch (e) {}
    throw err;
  }
}

export async function performChargeEntry(apiBaseUrl: string, chargeEntryRequestBody: any, token: string, logFn?: (entry: ApiLogEntry) => void) {
  const base = apiBase(apiBaseUrl);
  const rel = `/CaseToCharge/SavePerformedProcedure/`;
  const url = base + rel;
  try {
    // suppressed verbose debug logs
    // Use the shared postJson wrapper which returns response data or throws on error
    const res = await postJson(url, chargeEntryRequestBody, 20000, { 'Content-Type': 'application/json', token }, logFn);
    // postJson returns the response body. To mirror the Java behavior, only return when successful (we are here because no error thrown)
    try { if (logFn) logFn({ url, method: 'POST', status: 200, timestamp: new Date().toISOString() } as any); } catch (e) {}
    // Return the raw response as string if possible to match Java's asString()
    try { return typeof res === 'string' ? res : JSON.stringify(res); } catch (e) { return res; }
  } catch (err: any) {
    // Enhanced error logging
    // suppressed error log
    try {
      const resp = err && err.response ? err.response : null;
      if (resp) {
        // suppressed response diagnostics
      }
    } catch (ee) {}
    try { if (logFn) logFn({ url, method: 'POST', status: 'error', error: err && err.message ? err.message : String(err), timestamp: new Date().toISOString() } as any); } catch (e) {}
    // Mirror Java behavior: log and return null on non-200 responses instead of throwing
    return null;
  }
}

export async function performPatientChargeEntry(apiBaseUrl: string, casesToCodeResponse: any, options?: PerformPatientChargeEntryOptions) {
  const defaults: ChargeEntryPeriodBatch = { periodId: 18463, periodName: 'A_2018', batchId: 20318, batchDescription: 'bone' };
  const override = options?.periodBatch;
  const periodId = override?.periodId ?? defaults.periodId;
  const periodName = override?.periodName ?? defaults.periodName;
  const batchId = override?.batchId ?? defaults.batchId;
  const batchDescription = override?.batchDescription ?? defaults.batchDescription;
  const periodObj: any = { periodId, periodName };
  const batchObj: any = { batchId, batchDescription };
  const amountFallback = options?.amount ?? '200';
  const authToken = options?.token ?? '';
  const logFn = options?.logFn;

  // ensure casesToCodeResponse.result.performedItems exists
  const performedProcedures = extractPerformedProcedures(casesToCodeResponse);
  const targetCaseSummaryId = options?.caseSummaryId ?? (performedProcedures[0]?.caseSummaryId);
  const caseSummaryIdStr = typeof targetCaseSummaryId !== 'undefined' && targetCaseSummaryId !== null ? String(targetCaseSummaryId) : '';

  if (!performedProcedures.length) {
    throw new Error(`No performed procedures returned for case ${caseSummaryIdStr || 'unknown'}, skipping charge entry.`);
  }

  // helper to resolve amount per performed procedure using multiple possible sources from UI
  function resolveAmount(perf: any, resp: any, fallback: string | number): number {
    try {
      const fb = Number(parseFloat(String(fallback ?? '200')));
      // direct on performed item
      const direct = (perf && typeof perf._amount !== 'undefined') ? Number(parseFloat(String(perf._amount))) : NaN;
      if (!Number.isNaN(direct) && direct > 0) return Math.round(direct);
      // feeScheduleItem annotated
      const fsAmt = (perf && perf.feeScheduleItem && typeof perf.feeScheduleItem._amount !== 'undefined') ? Number(parseFloat(String(perf.feeScheduleItem._amount))) : NaN;
      if (!Number.isNaN(fsAmt) && fsAmt > 0) return Math.round(fsAmt);
      // response-level cptAmounts mapping: try by cptProcedureId then by cptCode
      try {
        const m = resp && resp.cptAmounts ? resp.cptAmounts : (resp && resp.result && resp.result.cptAmounts ? resp.result.cptAmounts : null);
        if (m && typeof m === 'object') {
          const pid = String(perf?.cptProcedureId ?? perf?.feeScheduleItem?.cptProcedureId ?? '');
          if (pid && Object.prototype.hasOwnProperty.call(m, pid)) {
            const v = Number(parseFloat(String(m[pid])));
            if (!Number.isNaN(v) && v > 0) return Math.round(v);
          }
          const code = String(perf?.cptCode ?? perf?.feeScheduleItem?.cptCode ?? '');
          if (code && Object.prototype.hasOwnProperty.call(m, code)) {
            const v2 = Number(parseFloat(String(m[code])));
            if (!Number.isNaN(v2) && v2 > 0) return Math.round(v2);
          }
        }
      } catch (e) {}
      // feeScheduleOverride array with _amount tagged, match by cptProcedureId
      try {
        const overrides = resp && resp.feeScheduleOverride ? resp.feeScheduleOverride : (resp && resp.result && resp.result.feeScheduleOverride ? resp.result.feeScheduleOverride : null);
        if (Array.isArray(overrides)) {
          const pidNum = Number(perf?.cptProcedureId ?? perf?.feeScheduleItem?.cptProcedureId ?? NaN);
          const found = overrides.find((fs: any) => {
            const fsPid = Number(fs?.cptProcedure?.cptProcedureId ?? fs?.cptProcedureId ?? fs?.id ?? NaN);
            return !Number.isNaN(fsPid) && fsPid === pidNum;
          });
          if (found && typeof found._amount !== 'undefined') {
            const v = Number(parseFloat(String(found._amount)));
            if (!Number.isNaN(v) && v > 0) return Math.round(v);
          }
        }
      } catch (e) {}
      return Math.round(fb);
    } catch (e) {
      return Math.round(Number(parseFloat(String(fallback ?? '200'))));
    }
  }

  const tplPath = path.join(__dirname, '..', 'reqTemplates', 'chargeEntryRequest.json');
  const chargeEntries: any[] = [];

  for (let i = 0; i < performedProcedures.length; i++) {
    const performedProcedure = performedProcedures[i];
    let tplArr: any[] = [];
    try { tplArr = JSON.parse(fs.readFileSync(tplPath, 'utf8')); } catch (e) { tplArr = [{}]; }
    const chargeEntryObject: any = JSON.parse(JSON.stringify(tplArr[0] || {}));

    const transactionList = chargeEntryObject.transactionList && Array.isArray(chargeEntryObject.transactionList) ? chargeEntryObject.transactionList : [];
    const transactionObject = transactionList[0] || {};
    const chargeDetails = (transactionObject && transactionObject.chargeDetails) ? transactionObject.chargeDetails : {};
    const chargeTransactionObject = chargeEntryObject.chargeTransaction || {};
    const chargeTransactionChargeDetails = (chargeTransactionObject && chargeTransactionObject.chargeDetails) ? chargeTransactionObject.chargeDetails : {};

    // map fields
    chargeEntryObject.cptProcedureId = performedProcedure.cptProcedureId;
    chargeEntryObject.patientId = performedProcedure.patientId;
    chargeEntryObject.caseProcedureId = performedProcedure.caseProcedureId;
    chargeEntryObject.cptCode = performedProcedure.cptCode;
    chargeEntryObject.physicianName = performedProcedure.physicianName;
    chargeEntryObject.performedCaseProcedureId = performedProcedure.performedCaseProcedureId ?? performedProcedure.performedCaseProcedureId;
    chargeDetails.peformedCaseProcedureId = performedProcedure.performedCaseProcedureId ?? performedProcedure.performedCaseProcedureId;
    const amtNum = resolveAmount(performedProcedure, casesToCodeResponse, amountFallback);
    chargeDetails.balance = amtNum;
    chargeDetails.transactionId = 0;
    chargeEntryObject.units = 1;
    chargeEntryObject.sortorder = i;
    const caseSummaryId = String(performedProcedure.caseSummaryId ?? '');
    chargeEntryObject.feeScheduleItem = performedProcedure.feeScheduleItem;
    chargeEntryObject.cptProcedureDescription = performedProcedure.cptProcedureDescription;
    chargeEntryObject.caseSummaryId = performedProcedure.caseSummaryId;
    chargeEntryObject.providerId = performedProcedure.providerId;
    chargeEntryObject.feeScheduleId = performedProcedure.feeScheduleId;
    chargeEntryObject.diagnosisList = performedProcedure.diagnosisList;

    // transaction fields
    transactionObject.period = periodObj;
    transactionObject.batch = batchObj;
    transactionObject.transactionId = 0;
    transactionObject.periodId = periodId;
    transactionObject.batchId = batchId;
    transactionObject.amount = String(amtNum);
    transactionObject.batchDescription = batchDescription;
    transactionObject.chargeDetails = chargeDetails;

    // reset transactionList to ensure only this transaction
    chargeEntryObject.transactionList = [transactionObject];

    // chargeTransaction fields
    chargeTransactionChargeDetails.peformedCaseProcedureId = performedProcedure.performedCaseProcedureId;
    chargeTransactionChargeDetails.balance = amtNum;
    chargeTransactionChargeDetails.transactionId = 0;
    chargeTransactionObject.periodId = periodId;
    chargeTransactionObject.batchId = batchId;
    chargeTransactionObject.batchDescription = batchDescription;
    chargeTransactionObject.amount = amtNum;
    chargeTransactionObject.period = periodObj;
    chargeTransactionObject.batch = batchObj;
    chargeTransactionObject.chargeDetails = chargeTransactionChargeDetails;
    chargeEntryObject.chargeTransaction = chargeTransactionObject;

    // remove insurance mapping per user note
    chargeEntryObject.chargeEntryPatientInsMap = [];
    chargeEntryObject.primaryInsurancesList = [];
    chargeEntryObject.secondaryInsurancesList = [];
    chargeEntryObject.tertiaryInsurancesList = [];

    chargeEntries.push(chargeEntryObject);
  }

  // call performChargeEntry
  const chargeEntryResponse = await performChargeEntry(apiBaseUrl, chargeEntries, authToken, logFn);
  // update case status to '12'
  if (caseSummaryIdStr) {
    try { await updateCaseStatus(apiBaseUrl, caseSummaryIdStr, '12', authToken, logFn); } catch (e) {}
  }
  // store/get charge details
  const chargeDetailsStr = getChargeDetailsFromChargeEntryResp(chargeEntryResponse);
  // call update and upsert again
  if (caseSummaryIdStr) {
    try { await updateCaseStatus(apiBaseUrl, caseSummaryIdStr, '12', authToken, logFn); } catch (e) {}
    try { await upsertCaseSummaryInfo(apiBaseUrl, caseSummaryIdStr, '12', '11', authToken, logFn); } catch (e) {}
  }

  return { chargeEntryResponse, chargeDetails: chargeDetailsStr };
}

export function getChargeDetailsFromChargeEntryResp(chargeEntryResponse: any) {
  try {
    const obj = chargeEntryResponse && typeof chargeEntryResponse === 'string' ? JSON.parse(chargeEntryResponse) : chargeEntryResponse;
    const resArr = obj && obj.result ? obj.result : (Array.isArray(obj) ? obj : []);
    const first = Array.isArray(resArr) ? resArr[0] : resArr;
    if (first && first.transactionList && first.transactionList[0] && first.transactionList[0].chargeDetails) {
      return JSON.stringify(first.transactionList[0].chargeDetails);
    }
  } catch (e) {}
  return null;
}

export default {
  getScheduledProcedures,
  getICDCode,
  performCasesToCode,
  performPatientCasesToCode,
};
