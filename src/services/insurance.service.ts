import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { ApiLogEntry } from '../utils/api';

const SAVE_INSURANCE_ENDPOINT = '/api/InsuranceCarrierObject/SaveInsuranceCarrier';
const INSERT_CLAIM_OFFICE_ENDPOINT = '/api/Insurance/InsertInsuranceClaimOffice';
const UPDATE_CLAIM_OFFICE_ENDPOINT = '/api/Insurance/UpdateInsuranceClaimOffice';
const SAVE_INSURANCE_PLAN_ENDPOINT = '/api/InsurancePlan/SaveInsurancePlan';

export type SaveInsuranceOptions = {
  apiBaseUrl: string;
  token: string;
  payload?: any;
  suffix?: string; // value passed from UI, used to build insuranceCarrierName => `insurance${suffix}`
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  logFn?: (entry: ApiLogEntry) => void;
};

const SAVE_INSURANCE_TEMPLATE_PATH = path.join(__dirname, '..', 'reqTemplates', 'saveInsuranceCarrier.json');
const INSERT_INSURANCE_TEMPLATE_PATH = path.join(__dirname, '..', 'reqTemplates', 'insertInsurance.json');
let cachedSaveInsuranceTemplate: any | null = null;
let cachedInsertInsuranceTemplate: any | null = null;

function loadSaveInsuranceTemplate() {
  if (cachedSaveInsuranceTemplate) return cachedSaveInsuranceTemplate;
  try {
    const raw = fs.readFileSync(SAVE_INSURANCE_TEMPLATE_PATH, 'utf8');
    cachedSaveInsuranceTemplate = JSON.parse(raw);
    return cachedSaveInsuranceTemplate;
  } catch (err) {
    throw new Error(`Failed to load saveInsuranceCarrier template: ${err}`);
  }
}

function loadInsertInsuranceTemplate() {
  if (cachedInsertInsuranceTemplate) return cachedInsertInsuranceTemplate;
  try {
    const raw = fs.readFileSync(INSERT_INSURANCE_TEMPLATE_PATH, 'utf8');
    cachedInsertInsuranceTemplate = JSON.parse(raw);
    return cachedInsertInsuranceTemplate;
  } catch (err) {
    throw new Error(`Failed to load insertInsurance template: ${err}`);
  }
}

function cloneInsertInsuranceTemplate() {
  return JSON.parse(JSON.stringify(loadInsertInsuranceTemplate()));
}

function buildHeaders(token: string, extra?: Record<string, string>) {
  const base: Record<string, string> = {
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    token,
  };
  if (extra) {
    for (const k of Object.keys(extra)) base[k] = extra[k];
  }
  return base;
}

function formatErrorMessage(err: any) {
  try {
    if (!err) return String(err);
    if (typeof err === 'string') return err;
    if (err && (err as any).message) return String((err as any).message);
    return String(err);
  } catch (e) {
    return String(err);
  }
}

function coerceNumber(...values: Array<any>) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const num = Number(value);
    if (!Number.isNaN(num)) return num;
  }
  return undefined;
}

function pickFirstString(...values: Array<any>) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export async function saveInsuranceCarrier({ apiBaseUrl, token, payload, timeoutMs = 10000, extraHeaders, logFn }: SaveInsuranceOptions) {
  if (!apiBaseUrl) throw new Error('apiBaseUrl is required');
  if (!token) throw new Error('token is required');
  const base = String(apiBaseUrl).replace(/\/$/, '');
  const url = `${base}${SAVE_INSURANCE_ENDPOINT}`;
  const headers = buildHeaders(token, extraHeaders);
  // load template if payload not provided
  let bodyPayload: any = payload && typeof payload === 'object' ? payload : JSON.parse(JSON.stringify(loadSaveInsuranceTemplate()));
  // if caller provided a suffix, build insuranceCarrierName as `insurance${suffix}`
  const anyOpts: any = arguments[0] as any;
  if (anyOpts && anyOpts.suffix) {
    const suffixVal = String(anyOpts.suffix).trim();
    bodyPayload.insuranceCarrierName = `insurance${suffixVal}`;
  }
  const start = Date.now();
  const startIso = new Date(start).toISOString();
  try {
    const res = await axios.put(url, bodyPayload, { timeout: timeoutMs, headers });
    const end = Date.now();
    const entry: ApiLogEntry = { url, method: 'PUT', status: res.status, durationMs: end - start, startTime: startIso, endTime: new Date(end).toISOString(), timestamp: new Date(end).toISOString() };
    try { if (logFn) logFn(entry); } catch (e) {}
    return res.data;
  } catch (err: any) {
    const end = Date.now();
    const resp = err && err.response ? err.response : undefined;
    const statusVal = resp && resp.status ? resp.status : 'error';
    const entry: ApiLogEntry = { url, method: 'PUT', status: statusVal, durationMs: end - start, error: err && err.message ? err.message : String(err), startTime: startIso, endTime: new Date(end).toISOString(), timestamp: new Date(end).toISOString() };
    try { if (logFn) logFn(entry); } catch (e) {}
    throw err;
  }
}

export type InsertInsuranceClaimOfficeOptions = {
  apiBaseUrl: string;
  token: string;
  payload?: any;
  // optional: provide the full response object returned from saveInsuranceCarrier
  carrierResponse?: any;
  // optional: provide the numeric carrier id directly (preferred)
  carrierId?: number;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  logFn?: (entry: ApiLogEntry) => void;
};

export async function insertInsuranceClaimOffice({ apiBaseUrl, token, payload, timeoutMs = 10000, extraHeaders, logFn }: InsertInsuranceClaimOfficeOptions) {
  if (!apiBaseUrl) throw new Error('apiBaseUrl is required');
  if (!token) throw new Error('token is required');
  const base = String(apiBaseUrl).replace(/\/$/, '');
  const url = `${base}${INSERT_CLAIM_OFFICE_ENDPOINT}`;
  const headers = buildHeaders(token, extraHeaders);
  const start = Date.now();
  const startIso = new Date(start).toISOString();
  // load template if payload not provided
  const INSERT_CLAIM_OFFICE_TEMPLATE_PATH = path.join(__dirname, '..', 'reqTemplates', 'insertInsuranceClaimOffice.json');
  let bodyPayload: any = payload && typeof payload === 'object' ? payload : null;
  if (!bodyPayload) {
    try {
      const raw = fs.readFileSync(INSERT_CLAIM_OFFICE_TEMPLATE_PATH, 'utf8');
      bodyPayload = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Failed to load insertInsuranceClaimOffice template: ${e}`);
    }
  }
  // If caller passed carrierId or carrierResponse, extract insuranceCarrierId and override template field
  const optsAny: any = arguments[0] as any;
  let extractedCarrierId: number | undefined = undefined;
  if (optsAny && typeof optsAny.carrierId === 'number') extractedCarrierId = optsAny.carrierId;
  if (!extractedCarrierId && optsAny && optsAny.carrierResponse) {
    const cr = optsAny.carrierResponse;
    if (cr && typeof cr === 'object') {
      if (typeof cr.insuranceCarrierId === 'number') extractedCarrierId = cr.insuranceCarrierId;
      else if (typeof cr.insuranceCarrierObjectId === 'number') extractedCarrierId = cr.insuranceCarrierObjectId;
    }
  }
  if (typeof extractedCarrierId === 'number') {
    bodyPayload.insuranceCarrierObjectId = extractedCarrierId;
  }

  try {
    const res = await axios.post(url, bodyPayload, { timeout: timeoutMs, headers });
    const end = Date.now();
    const entry: ApiLogEntry = { url, method: 'POST', status: res.status, durationMs: end - start, startTime: startIso, endTime: new Date(end).toISOString(), timestamp: new Date(end).toISOString() };
    try { if (logFn) logFn(entry); } catch (e) {}
    return res.data;
  } catch (err: any) {
    const end = Date.now();
    const resp = err && err.response ? err.response : undefined;
    const statusVal = resp && resp.status ? resp.status : 'error';
    const entry: ApiLogEntry = { url, method: 'POST', status: statusVal, durationMs: end - start, error: err && err.message ? err.message : String(err), startTime: startIso, endTime: new Date(end).toISOString(), timestamp: new Date(end).toISOString() };
    try { if (logFn) logFn(entry); } catch (e) {}
    throw err;
  }
}

export type UpdateInsuranceClaimOfficeOptions = {
  apiBaseUrl: string;
  token: string;
  payload?: any;
  // optional: id or response from previous calls
  carrierId?: number;
  carrierResponse?: any;
  claimOfficeId?: number;
  claimOfficeResponse?: any;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  logFn?: (entry: ApiLogEntry) => void;
};

export async function updateInsuranceClaimOffice({ apiBaseUrl, token, payload, timeoutMs = 10000, extraHeaders, logFn }: UpdateInsuranceClaimOfficeOptions) {
  if (!apiBaseUrl) throw new Error('apiBaseUrl is required');
  if (!token) throw new Error('token is required');
  const base = String(apiBaseUrl).replace(/\/$/, '');
  const url = `${base}${UPDATE_CLAIM_OFFICE_ENDPOINT}`;
  const headers = buildHeaders(token, extraHeaders);
  const start = Date.now();
  const startIso = new Date(start).toISOString();
  // load template if payload not provided
  const UPDATE_CLAIM_OFFICE_TEMPLATE_PATH = path.join(__dirname, '..', 'reqTemplates', 'updateInsuranceClaimOffice.json');
  let bodyPayload: any = payload && typeof payload === 'object' ? payload : null;
  if (!bodyPayload) {
    try {
      const raw = fs.readFileSync(UPDATE_CLAIM_OFFICE_TEMPLATE_PATH, 'utf8');
      bodyPayload = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Failed to load updateInsuranceClaimOffice template: ${e}`);
    }
  }

  // extract ids from options if provided
  const optsAny: any = arguments[0] as any;
  let extractedCarrierId: number | undefined = undefined;
  if (optsAny && typeof optsAny.carrierId === 'number') extractedCarrierId = optsAny.carrierId;
  if (!extractedCarrierId && optsAny && optsAny.carrierResponse) {
    const cr = optsAny.carrierResponse;
    if (cr && typeof cr === 'object') {
      if (typeof cr.insuranceCarrierId === 'number') extractedCarrierId = cr.insuranceCarrierId;
      else if (typeof cr.insuranceCarrierObjectId === 'number') extractedCarrierId = cr.insuranceCarrierObjectId;
    }
  }

  let extractedClaimOfficeId: number | undefined = undefined;
  if (optsAny && typeof optsAny.claimOfficeId === 'number') extractedClaimOfficeId = optsAny.claimOfficeId;
  if (!extractedClaimOfficeId && optsAny && optsAny.claimOfficeResponse) {
    const cor = optsAny.claimOfficeResponse;
    if (cor && typeof cor === 'object' && typeof cor.claimOfficeId === 'number') extractedClaimOfficeId = cor.claimOfficeId;
  }

  if (typeof extractedCarrierId === 'number') bodyPayload.insuranceCarrierObjectId = extractedCarrierId;
  if (typeof extractedClaimOfficeId === 'number') bodyPayload.claimOfficeId = extractedClaimOfficeId;

  try {
    const res = await axios.post(url, bodyPayload, { timeout: timeoutMs, headers });
    const end = Date.now();
    const entry: ApiLogEntry = { url, method: 'POST', status: res.status, durationMs: end - start, startTime: startIso, endTime: new Date(end).toISOString(), timestamp: new Date(end).toISOString() };
    try { if (logFn) logFn(entry); } catch (e) {}
    return res.data;
  } catch (err: any) {
    const end = Date.now();
    const resp = err && err.response ? err.response : undefined;
    const statusVal = resp && resp.status ? resp.status : 'error';
    const entry: ApiLogEntry = { url, method: 'POST', status: statusVal, durationMs: end - start, error: err && err.message ? err.message : String(err), startTime: startIso, endTime: new Date(end).toISOString(), timestamp: new Date(end).toISOString() };
    try { if (logFn) logFn(entry); } catch (e) {}
    throw err;
  }
}

export type SaveInsurancePlanOptions = {
  apiBaseUrl: string;
  token: string;
  payload?: any;
  // ids or responses to extract ids from
  carrierId?: number;
  carrierResponse?: any; // response from saveInsuranceCarrier
  claimOfficeId?: number;
  claimOfficeResponse?: any; // response from insertInsuranceClaimOffice
  // optionally plan id directly
  insurancePlanId?: number;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  logFn?: (entry: ApiLogEntry) => void;
};

export async function saveInsurancePlan({ apiBaseUrl, token, payload, timeoutMs = 10000, extraHeaders, logFn }: SaveInsurancePlanOptions) {
  if (!apiBaseUrl) throw new Error('apiBaseUrl is required');
  if (!token) throw new Error('token is required');
  const base = String(apiBaseUrl).replace(/\/$/, '');
  const url = `${base}${SAVE_INSURANCE_PLAN_ENDPOINT}`;
  const headers = buildHeaders(token, extraHeaders);
  // load template if payload not provided
  const SAVE_INSURANCE_PLAN_TEMPLATE_PATH = path.join(__dirname, '..', 'reqTemplates', 'saveInsurancePlan.json');
  let bodyPayload: any = payload && typeof payload === 'object' ? payload : null;
  if (!bodyPayload) {
    try {
      const raw = fs.readFileSync(SAVE_INSURANCE_PLAN_TEMPLATE_PATH, 'utf8');
      bodyPayload = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Failed to load saveInsurancePlan template: ${e}`);
    }
  }

  // extract ids from options/responses
  const optsAny: any = arguments[0] as any;
  let extractedCarrierId: number | undefined = undefined;
  if (optsAny && typeof optsAny.carrierId === 'number') extractedCarrierId = optsAny.carrierId;
  if (!extractedCarrierId && optsAny && optsAny.carrierResponse) {
    const cr = optsAny.carrierResponse;
    if (cr && typeof cr === 'object') {
      if (typeof cr.insuranceCarrierId === 'number') extractedCarrierId = cr.insuranceCarrierId;
      else if (typeof cr.insuranceCarrierObjectId === 'number') extractedCarrierId = cr.insuranceCarrierObjectId;
      // try nested insurancePlanSaveDetails for plan id later
    }
  }

  let extractedClaimOfficeId: number | undefined = undefined;
  if (optsAny && typeof optsAny.claimOfficeId === 'number') extractedClaimOfficeId = optsAny.claimOfficeId;
  if (!extractedClaimOfficeId && optsAny && optsAny.claimOfficeResponse) {
    const cor = optsAny.claimOfficeResponse;
    if (cor && typeof cor === 'object' && typeof cor.claimOfficeId === 'number') extractedClaimOfficeId = cor.claimOfficeId;
  }

  let extractedPlanId: number | undefined = undefined;
  if (optsAny && typeof optsAny.insurancePlanId === 'number') extractedPlanId = optsAny.insurancePlanId;
  if (!extractedPlanId && optsAny && optsAny.carrierResponse) {
    const cr = optsAny.carrierResponse;
    if (cr && typeof cr === 'object') {
      const nested = cr.insurancePlanSaveDetails ?? cr.insurancePlanSaveDetails;
      if (nested && typeof nested.insurancePlanId === 'number') extractedPlanId = nested.insurancePlanId;
    }
  }

  if (typeof extractedCarrierId === 'number') bodyPayload.insuranceCarrierId = extractedCarrierId;
  if (typeof extractedClaimOfficeId === 'number') bodyPayload.claimOfficeId = extractedClaimOfficeId;
  if (typeof extractedPlanId === 'number') bodyPayload.insurancePlanId = extractedPlanId;

  const start = Date.now();
  const startIso = new Date(start).toISOString();
  try {
    const res = await axios.put(url, bodyPayload, { timeout: timeoutMs, headers });
    const end = Date.now();
    const entry: ApiLogEntry = { url, method: 'PUT', status: res.status, durationMs: end - start, startTime: startIso, endTime: new Date(end).toISOString(), timestamp: new Date(end).toISOString() };
    try { if (logFn) logFn(entry); } catch (e) {}
    return res.data;
  } catch (err: any) {
    const end = Date.now();
    const resp = err && err.response ? err.response : undefined;
    const statusVal = resp && resp.status ? resp.status : 'error';
    const entry: ApiLogEntry = { url, method: 'PUT', status: statusVal, durationMs: end - start, error: err && err.message ? err.message : String(err), startTime: startIso, endTime: new Date(end).toISOString(), timestamp: new Date(end).toISOString() };
    try { if (logFn) logFn(entry); } catch (e) {}
    throw err;
  }
}

export type InsertInsuranceGeminiOptions = {
  apiBaseUrl?: string; // optional base to build URL
  fullUrl?: string; // optional full URL (uses this if provided)
  token: string;
  payload?: any;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  logFn?: (entry: ApiLogEntry) => void;
};

/**
 * Calls the external Gemini Insert insurance endpoint.
 * If `fullUrl` is provided it will be used; otherwise `apiBaseUrl` + fixed path is used.
 */
export async function insertInsuranceGemini({ apiBaseUrl, fullUrl, token, payload = {}, timeoutMs = 10000, extraHeaders, logFn }: InsertInsuranceGeminiOptions) {
  if (!fullUrl && !apiBaseUrl) throw new Error('fullUrl or apiBaseUrl is required');
  if (!token) throw new Error('token is required');
  const url = fullUrl ? String(fullUrl) : `${String(apiBaseUrl).replace(/\/$/, '')}/api/Insurance/Gemini/Insert/0`;
  const headers = buildHeaders(token, extraHeaders);
  // The external endpoint in the example expects `text/json` content-type/accept
  headers['accept'] = 'text/json';
  headers['content-type'] = 'text/json';
  const bodyPayload = payload && typeof payload === 'object' ? payload : cloneInsertInsuranceTemplate();
  const start = Date.now();
  const startIso = new Date(start).toISOString();
  try {
    const res = await axios.post(url, bodyPayload, { timeout: timeoutMs, headers });
    const end = Date.now();
    const entry: ApiLogEntry = { url, method: 'POST', status: res.status, durationMs: end - start, startTime: startIso, endTime: new Date(end).toISOString(), timestamp: new Date(end).toISOString() };
    try { if (logFn) logFn(entry); } catch (e) {}
    return res.data;
  } catch (err: any) {
    const end = Date.now();
    const resp = err && err.response ? err.response : undefined;
    const statusVal = resp && resp.status ? resp.status : 'error';
    const entry: ApiLogEntry = { url, method: 'POST', status: statusVal, durationMs: end - start, error: err && err.message ? err.message : String(err), startTime: startIso, endTime: new Date(end).toISOString(), timestamp: new Date(end).toISOString() };
    try { if (logFn) logFn(entry); } catch (e) {}
    throw err;
  }
}

export type InsuranceInsertOverrides = {
  insuranceCarrierId?: number;
  carrier?: string;
  insuranceId?: number | string;
  insuranceClaimOfficeId?: number;
};

export type InsertInsurancePayloadOverrides = InsuranceInsertOverrides & {
  patientId?: number;
  firstName?: string;
  lastName?: string;
};

export function createInsertInsurancePayload(overrides?: InsertInsurancePayloadOverrides) {
  const payload = cloneInsertInsuranceTemplate();
  if (!overrides) return payload;
  if (overrides.patientId !== undefined) payload.patientId = overrides.patientId;
  if (overrides.firstName !== undefined) payload.firstName = overrides.firstName;
  if (overrides.lastName !== undefined) payload.lastName = overrides.lastName;
  if (overrides.insuranceCarrierId !== undefined) payload.insuranceCarrierId = overrides.insuranceCarrierId;
  if (overrides.carrier !== undefined) payload.carrier = overrides.carrier;
  if (overrides.insuranceId !== undefined) payload.insuranceId = overrides.insuranceId;
  if (overrides.insuranceClaimOfficeId !== undefined) payload.insuranceClaimOfficeId = overrides.insuranceClaimOfficeId;
  return payload;
}

export type CreateInsuranceResult = {
  carrier: any;
  insertClaimOffice: any;
  updateClaimOffice: any;
  plan: any;
};

export function extractInsuranceInsertOverrides(result?: CreateInsuranceResult | null): InsuranceInsertOverrides | undefined {
  if (!result) return undefined;
  const overrides: InsuranceInsertOverrides = {};
  const carrier = result.carrier ?? {};
  const plan = result.plan ?? {};
  const insertClaim = result.insertClaimOffice ?? {};
  const updateClaim = result.updateClaimOffice ?? {};
  const carrierId = coerceNumber(carrier.insuranceCarrierId, carrier.insuranceCarrierObjectId, carrier.insuranceCarrierID);
  if (typeof carrierId === 'number') overrides.insuranceCarrierId = carrierId;
  const carrierName = pickFirstString(carrier.insuranceCarrierName, carrier.carrier, carrier.carrierName, carrier.name);
  if (carrierName) overrides.carrier = carrierName;
  const insuranceIdCandidates = [plan.insuranceId, plan.insurancePlanId, plan.planId, plan.insurancePlanID, carrier.insuranceId];
  for (const candidate of insuranceIdCandidates) {
    if (candidate === undefined || candidate === null) continue;
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) {
        overrides.insuranceId = candidate;
        break;
      }
    } else {
      overrides.insuranceId = candidate;
      break;
    }
  }
  const claimOfficeId = coerceNumber(insertClaim.insuranceClaimOfficeId, insertClaim.claimOfficeId, updateClaim.insuranceClaimOfficeId, updateClaim.claimOfficeId);
  if (typeof claimOfficeId === 'number') overrides.insuranceClaimOfficeId = claimOfficeId;
  return Object.keys(overrides).length ? overrides : undefined;
}

export default {
  saveInsuranceCarrier,
  insertInsuranceClaimOffice,
  updateInsuranceClaimOffice,
  saveInsurancePlan,
  insertInsuranceGemini,
  createInsurance,
  createInsertInsurancePayload,
  extractInsuranceInsertOverrides,
};

export type CreateInsuranceOptions = {
  apiBaseUrl: string;
  token: string;
  suffix?: string; // used for carrier name
  // optional overrides / custom payloads
  carrierPayload?: any;
  insertClaimPayload?: any;
  updateClaimPayload?: any;
  planPayload?: any;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  logFn?: (entry: ApiLogEntry) => void;
};

export async function createInsurance(opts: CreateInsuranceOptions): Promise<CreateInsuranceResult> {
  if (!opts || typeof opts !== 'object') throw new Error('options are required');
  const { apiBaseUrl, token, suffix, timeoutMs = 20000, extraHeaders, logFn } = opts;
  if (!apiBaseUrl) throw new Error('apiBaseUrl is required');
  if (!token) throw new Error('token is required');

  // 1) save carrier
  let carrierResp: any;
  try {
    carrierResp = await saveInsuranceCarrier({ apiBaseUrl, token, payload: opts.carrierPayload, suffix, timeoutMs, extraHeaders, logFn });
  } catch (err) {
    throw new Error(`saveInsuranceCarrier failed: ${formatErrorMessage(err)}`);
  }

  const carrierId = carrierResp && (carrierResp.insuranceCarrierId ?? carrierResp.insuranceCarrierObjectId);

  // 2) insert claim office
  let insertResp: any;
  try {
    insertResp = await insertInsuranceClaimOffice({ apiBaseUrl, token, payload: opts.insertClaimPayload, carrierId, carrierResponse: carrierResp, timeoutMs, extraHeaders, logFn });
  } catch (err) {
    throw new Error(`insertInsuranceClaimOffice failed: ${formatErrorMessage(err)}`);
  }

  const claimOfficeId = insertResp && insertResp.claimOfficeId;

  // 3) update claim office
  let updateResp: any;
  try {
    updateResp = await updateInsuranceClaimOffice({ apiBaseUrl, token, payload: opts.updateClaimPayload, carrierId, carrierResponse: carrierResp, claimOfficeId, claimOfficeResponse: insertResp, timeoutMs, extraHeaders, logFn });
  } catch (err) {
    throw new Error(`updateInsuranceClaimOffice failed: ${formatErrorMessage(err)}`);
  }

  // 4) save insurance plan
  let planResp: any;
  try {
    planResp = await saveInsurancePlan({ apiBaseUrl, token, payload: opts.planPayload, carrierId, carrierResponse: carrierResp, claimOfficeId, claimOfficeResponse: insertResp, timeoutMs, extraHeaders, logFn });
  } catch (err) {
    throw new Error(`saveInsurancePlan failed: ${formatErrorMessage(err)}`);
  }

  return {
    carrier: carrierResp,
    insertClaimOffice: insertResp,
    updateClaimOffice: updateResp,
    plan: planResp,
  };
}

