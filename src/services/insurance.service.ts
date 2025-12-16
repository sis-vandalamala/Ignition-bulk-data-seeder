import axios from 'axios';

export interface SaveInsuranceResult {
  insuranceCarrierId?: number;
  insurancePlanId?: number;
  raw?: any;
}

export async function saveInsuranceCarrier(
  token: string | undefined,
  apiBaseUrl: string | undefined,
  insuranceName: string,
  planName: string,
  insuranceClassification: string | null,
  electronicClaim: string | null,
  paperForm: string | null,
  ePayerCode: string | null
): Promise<SaveInsuranceResult> {
  if (!apiBaseUrl) throw new Error('apiBaseUrl is required for saveInsuranceCarrier');
  const base = String(apiBaseUrl).replace(/\/+$/, '');
  const url = `${base}/api/InsuranceCarrierObject/SaveInsuranceCarrier`;

  const payload: any = {};
  payload.electronicClaim = 1;
  payload.paperForm = 1;
  payload.insuranceCarrierId = 0;
  payload.insuranceCarrierName = insuranceName;
  payload.ePayerId = ePayerCode ?? null;

  const insurancePlanSaveDetails: any = {};
  insurancePlanSaveDetails.defaultPlanTf = true;
  insurancePlanSaveDetails.isInsurancePlanValid = false;
  insurancePlanSaveDetails.planName = planName;
  insurancePlanSaveDetails.classification = insuranceClassification ?? null;
  insurancePlanSaveDetails.primaryEmcPayerid = '066020';
  insurancePlanSaveDetails.claimOfficeId = null;

  payload.insurancePlanSaveDetails = insurancePlanSaveDetails;

  // map electronicClaim textual values to numeric codes
  if (electronicClaim != null && String(electronicClaim).trim() !== '') {
    const v = String(electronicClaim).toLowerCase();
    let electronicClaimValue = 0;
    if (v === 'institutional') electronicClaimValue = 1;
    else if (v === 'professional') electronicClaimValue = 2;
    payload.electronicClaim = electronicClaimValue;
  }

  // map paperForm textual values to numeric codes
  if (paperForm != null && String(paperForm).trim() !== '') {
    const v = String(paperForm).toLowerCase();
    let paperFormValue = 0;
    if (v === 'ub') paperFormValue = 1;
    else if (v === 'hcfa') paperFormValue = 2;
    payload.paperForm = paperFormValue;
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Referer: base + '/',
  };
  if (token) headers['token'] = token;

  try {
    const res = await axios.put(url, payload, { headers, timeout: 15000, responseType: 'json' });
    const data = res && res.data ? res.data : null;
    const result: SaveInsuranceResult = { raw: data };
    try {
      if (data && typeof data === 'object') {
        if (data.insuranceCarrierId != null) result.insuranceCarrierId = Number(data.insuranceCarrierId);
        // insurancePlanSaveDetails may be nested
        const planObj = data.insurancePlanSaveDetails || (data.insurancePlanSaveDetails === undefined ? null : data.insurancePlanSaveDetails);
        if (planObj && planObj.insurancePlanId != null) result.insurancePlanId = Number(planObj.insurancePlanId);
      }
    } catch (e) { /* ignore */ }
    return result;
  } catch (err: any) {
    // attempt to detect if insurance already exists based on error response body
    const resp = err && err.response ? err.response : undefined;
    const body = resp && resp.data ? resp.data : undefined;
    // rethrow with context
    const msg = err && err.message ? err.message : 'saveInsuranceCarrier failed';
    throw new Error(`${msg}${body ? ' - ' + JSON.stringify(body) : ''}`);
  }
}

export default {
  saveInsuranceCarrier,
};

export async function insertInsuranceClaimOffice(
  token: string | undefined,
  apiBaseUrl: string | undefined,
  insuranceCarrierObjectId: string | number,
  officeName: string,
  line1: string | null,
  city: string | null,
  contactName: string | null,
  phone: string | null,
  zip: string | null,
  extendedZip: string | null,
  state: string | null
): Promise<{ claimOfficeId?: number; raw?: any }> {
  if (!apiBaseUrl) throw new Error('apiBaseUrl is required for insertInsuranceClaimOffice');
  const base = String(apiBaseUrl).replace(/\/+$/, '');
  const url = `${base}/api/Insurance/InsertInsuranceClaimOffice`;

  const payload: any = {};
  payload.country = 'United States';
  payload.name = officeName;
  payload.line1 = line1 ?? null;
  payload.city = city ?? null;
  payload.state = state ?? null;
  payload.zip = zip ?? null;
  payload.extendedZip = extendedZip ?? null;
  payload.phone = phone ?? null;
  payload.contactName = contactName ?? null;
  payload.insuranceCarrierObjectId = insuranceCarrierObjectId;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Referer: base + '/',
  };
  if (token) headers['token'] = token;

  try {
    const res = await axios.post(url, payload, { headers, timeout: 15000, responseType: 'json' });
    const data = res && res.data ? res.data : null;
    const out: any = { raw: data };
    try {
      if (data && data.claimOfficeId != null) out.claimOfficeId = Number(data.claimOfficeId);
    } catch (e) {}
    return out;
  } catch (err: any) {
    const resp = err && err.response ? err.response : undefined;
    const body = resp && resp.data ? resp.data : undefined;
    const msg = err && err.message ? err.message : 'insertInsuranceClaimOffice failed';
    throw new Error(`${msg}${body ? ' - ' + JSON.stringify(body) : ''}`);
  }
}

export async function updateInsuranceClaimOffice(
  token: string | undefined,
  apiBaseUrl: string | undefined,
  claimOfficeId: number | string,
  insuranceCarrierObjectId: string | number,
  officeName: string,
  line1: string | null,
  city: string | null,
  contactName: string | null,
  phone: string | null,
  zip: string | null,
  extendedZip: string | null,
  state: string | null
): Promise<{ claimOfficeId?: number; raw?: any }> {
  if (!apiBaseUrl) throw new Error('apiBaseUrl is required for updateInsuranceClaimOffice');
  const base = String(apiBaseUrl).replace(/\/+$/, '');
  const url = `${base}/api/Insurance/UpdateInsuranceClaimOffice`;

  const payload: any = {};
  payload.claimOfficeId = Number(claimOfficeId);
  payload.insuranceCarrierObjectId = insuranceCarrierObjectId;
  payload.name = officeName;
  payload.line1 = line1 ?? null;
  payload.city = city ?? null;
  payload.contactName = contactName ?? null;
  payload.phone = phone ?? null;
  payload.zip = zip ?? null;
  payload.extendedZip = extendedZip ?? null;
  payload.state = state ?? null;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Referer: base + '/',
  };
  if (token) headers['token'] = token;

  try {
    const res = await axios.post(url, payload, { headers, timeout: 15000, responseType: 'json' });
    const data = res && res.data ? res.data : null;
    const out: any = { raw: data };
    try {
      if (data && data.claimOfficeId != null) out.claimOfficeId = Number(data.claimOfficeId);
    } catch (e) {}
    return out;
  } catch (err: any) {
    const resp = err && err.response ? err.response : undefined;
    const body = resp && resp.data ? resp.data : undefined;
    const msg = err && err.message ? err.message : 'updateInsuranceClaimOffice failed';
    throw new Error(`${msg}${body ? ' - ' + JSON.stringify(body) : ''}`);
  }
}

export async function saveInsurancePlan(
  token: string | undefined,
  apiBaseUrl: string | undefined,
  insuranceCarrierId: string | number,
  insurancePlanId: string | number | null,
  planName: string,
  insuranceClassification: string | null,
  officeName: string | null,
  line1: string | null,
  city: string | null,
  contactName: string | null,
  phone: string | null,
  zip: string | null,
  extendedZip: string | null,
  state: string | null,
  generateTrue: boolean,
  contractName: string | null,
  claimOfficeId?: number | null
): Promise<{ insurancePlanId?: number; raw?: any }> {
  if (!apiBaseUrl) throw new Error('apiBaseUrl is required for saveInsurancePlan');
  const base = String(apiBaseUrl).replace(/\/+$/, '');
  const url = `${base}/api/InsurancePlan/SaveInsurancePlan`;

  const payload: any = {};
  payload.insuranceCarrierId = insuranceCarrierId;
  if (insurancePlanId != null && String(insurancePlanId).trim() !== '') {
    payload.insurancePlanId = Number(insurancePlanId);
  }
  payload.planName = planName;
  payload.classification = insuranceClassification ?? null;
  payload.claimOfficeName = officeName ?? null;
  payload.generateClaimTf = !!generateTrue;
  payload.address1 = line1 ?? null;
  payload.city = city ?? null;
  payload.contactName = contactName ?? null;
  payload.phoneNumber = phone ?? null;
  payload.zip = zip ?? null;
  payload.extendedZipCode = extendedZip ?? null;
  payload.state = state ?? null;
  if (typeof claimOfficeId !== 'undefined' && claimOfficeId !== null) payload.claimOfficeId = Number(claimOfficeId);

  // Simple contract handling: if contractName provided (comma-separated), create contract placeholders
  if (contractName && String(contractName).trim() !== '') {
    const contracts = String(contractName).split(',').map(s => s.trim()).filter(Boolean);
    const insurancePlanContractList: any[] = [];
    const selectedContracts: any[] = [];
    let i = 0;
    for (const contrName of contracts) {
      const obj: any = {
        insurancePlanContractId: 0,
        insurancePlanId: payload.insurancePlanId != null ? Number(payload.insurancePlanId) : 0,
        insuranceContractId: 0,
        insuranceContractName: contrName,
        sortOrder: i,
        isSelected: true,
      };
      insurancePlanContractList.push(obj);

      const selected: any = {
        insuranceContractName: contrName,
        insuranceContractSelectedOrder: i + 1,
        insurancePlanContractId: 0,
        insurancePlanId: payload.insurancePlanId != null ? Number(payload.insurancePlanId) : undefined,
      };
      selectedContracts.push(selected);
      i++;
    }
    payload.insurancePlanContractList = insurancePlanContractList;
    payload.selectedContracts = selectedContracts;
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Referer: base + '/',
  };
  if (token) headers['token'] = token;

  try {
    const res = await axios.put(url, payload, { headers, timeout: 15000, responseType: 'json' });
    const data = res && res.data ? res.data : null;
    const out: any = { raw: data };
    try {
      if (data && data.insurancePlanId != null) out.insurancePlanId = Number(data.insurancePlanId);
    } catch (e) {}
    return out;
  } catch (err: any) {
    const resp = err && err.response ? err.response : undefined;
    const body = resp && resp.data ? resp.data : undefined;
    const msg = err && err.message ? err.message : 'saveInsurancePlan failed';
    throw new Error(`${msg}${body ? ' - ' + JSON.stringify(body) : ''}`);
  }
}

export async function createInsurance(
  token: string | undefined,
  apiBaseUrl: string | undefined,
  facility: string | undefined,
  insuranceName: string,
  electronicClaim: string | null,
  paperForm: string | null,
  planName: string,
  insuranceClassification: string | null,
  officeName: string | null,
  line1: string | null,
  city: string | null,
  contactName: string | null,
  phone: string | null,
  zip: string | null,
  extendedZip: string | null,
  State: string | null,
  generateTrue: boolean,
  contractName: string | null,
  ePayerCode: string | null
): Promise<Array<any>> {
  if (!apiBaseUrl) throw new Error('apiBaseUrl is required for createInsurance');

  // Helper to split values by ';' and get ith element or undefined
  const nth = (s: string | null | undefined, i: number) => {
    if (s === null || typeof s === 'undefined') return undefined;
    const parts = String(s).split(';');
    return parts[i] !== undefined ? parts[i] : undefined;
  };

  const names = String(insuranceName || '').split(';');
  const results: any[] = [];

  for (let i = 0; i < names.length; i++) {
    const insName = nth(insuranceName, i) || '';
    const plan = nth(planName, i) || planName || '';
    const eClaim = nth(electronicClaim, i) ?? electronicClaim ?? null;
    const pForm = nth(paperForm, i) ?? paperForm ?? null;
    const insClass = nth(insuranceClassification, i) ?? insuranceClassification ?? null;
    const office = nth(officeName, i) ?? officeName ?? null;
    const addr = nth(line1, i) ?? line1 ?? null;
    const cty = nth(city, i) ?? city ?? null;
    const contact = nth(contactName, i) ?? contactName ?? null;
    const ph = nth(phone, i) ?? phone ?? null;
    const zp = nth(zip, i) ?? zip ?? null;
    const extZip = nth(extendedZip, i) ?? extendedZip ?? null;
    const st = nth(State, i) ?? State ?? null;
    const contracts = nth(contractName, i) ?? contractName ?? null;
    const epayer = nth(ePayerCode, i) ?? ePayerCode ?? null;

    // map to store intermediate ids similar to mapWebServiceResponses
    const map: Record<string, any> = {
      insuranceCarrierId: null,
      insurancePlanId: null,
      insuranceClaimOfficeid: null,
    };

    try {
      // Save insurance carrier
      let savedCarrier: SaveInsuranceResult | null = null;
      try {
        savedCarrier = await saveInsuranceCarrier(token, apiBaseUrl, insName, plan, insClass, eClaim, pForm, epayer);
      } catch (err) {
        // if save failed, continue but capture error
        results.push({ insuranceName: insName, error: `saveInsuranceCarrier failed: ${String(err)}` });
        continue;
      }

      if (savedCarrier && savedCarrier.insuranceCarrierId) {
        map.insuranceCarrierId = savedCarrier.insuranceCarrierId;
      }
      if (savedCarrier && savedCarrier.insurancePlanId) {
        map.insurancePlanId = savedCarrier.insurancePlanId;
      }

      // Insert claim office if we don't have one
      let claimResp: { claimOfficeId?: number; raw?: any } | null = null;
      if (!map.insuranceClaimOfficeid && map.insuranceCarrierId) {
        try {
          claimResp = await insertInsuranceClaimOffice(token, apiBaseUrl, map.insuranceCarrierId, office || '', addr, cty, contact, ph, zp, extZip, st);
          if (claimResp && claimResp.claimOfficeId) map.insuranceClaimOfficeid = claimResp.claimOfficeId;
        } catch (err) {
          // capture and continue
          results.push({ insuranceName: insName, error: `insertInsuranceClaimOffice failed: ${String(err)}` });
          continue;
        }
      }

      // Save insurance plan (first time)
      let savedPlan: { insurancePlanId?: number; raw?: any } | null = null;
      try {
        savedPlan = await saveInsurancePlan(token, apiBaseUrl, map.insuranceCarrierId || '', map.insurancePlanId || null, plan, insClass, office, addr, cty, contact, ph, zp, extZip, st, generateTrue, contracts, map.insuranceClaimOfficeid || undefined);
        if (savedPlan && savedPlan.insurancePlanId) map.insurancePlanId = savedPlan.insurancePlanId;
      } catch (err) {
        results.push({ insuranceName: insName, error: `saveInsurancePlan failed (first): ${String(err)}` });
        // continue to attempt update
      }

      // Update claim office if we have it
      try {
        if (map.insuranceClaimOfficeid && map.insuranceCarrierId) {
          await updateInsuranceClaimOffice(token, apiBaseUrl, map.insuranceClaimOfficeid, map.insuranceCarrierId, office || '', addr, cty, contact, ph, zp, extZip, st);
        }
      } catch (err) {
        // log and continue
        results.push({ insuranceName: insName, warning: `updateInsuranceClaimOffice failed: ${String(err)}` });
      }

      // Save insurance plan again (finalize)
      try {
        const finalPlan = await saveInsurancePlan(token, apiBaseUrl, map.insuranceCarrierId || '', map.insurancePlanId || null, plan, insClass, office, addr, cty, contact, ph, zp, extZip, st, generateTrue, contracts, map.insuranceClaimOfficeid || undefined);
        if (finalPlan && finalPlan.insurancePlanId) map.insurancePlanId = finalPlan.insurancePlanId;
      } catch (err) {
        results.push({ insuranceName: insName, error: `saveInsurancePlan failed (second): ${String(err)}` });
      }

      results.push({ insuranceName: insName, result: map });
    } catch (err) {
      results.push({ insuranceName: insName, error: String(err) });
    }
  }

  return results;
}
