import axios from 'axios';
import { getJson } from '../utils/api';

export async function requestRecordLock(patientId: number, token: string, apiBaseUrl?: string) {
    if (!apiBaseUrl) throw new Error('apiBaseUrl is required for requestRecordLock');
    const base = String(apiBaseUrl).replace(/\/$/, '');
    const referer = base + '/';
    const url = `${base}/api/Security/RecordLock/RequestLock`;
    const headers: Record<string, string> = {
        'Content-Type': 'text/json',
        Accept: 'text/json',
        token,
        Referer: referer,
    };
    const body = {
        patientId,
        recordLockTypeId: 13,
        objectId: patientId,
        moduleId: 2030,
    };
    const res = await axios.post(url, body, { headers, timeout: 10000, responseType: 'json' });
    return res.data;
}

export async function releaseRecordLock(patientId: number, token: string, apiBaseUrl?: string) {
    if (!apiBaseUrl) throw new Error('apiBaseUrl is required for releaseRecordLock');
    const base = String(apiBaseUrl).replace(/\/$/, '');
    const referer = base + '/';
    const url = `${base}/api/Security/RecordLock/ReleaseLock`;
    const headers: Record<string, string> = {
        'Content-Type': 'text/json',
        Accept: 'text/json',
        token,
        Referer: referer,
    };
    const body = {
        patientId,
        recordLockTypeId: 13,
        objectId: patientId,
        moduleId: 2030,
    };
    const res = await axios.post(url, body, { headers, timeout: 10000, responseType: 'json' });
    return res.data;
}

export async function getRoomsForOrganization(token: string, apiBaseUrl?: string) {
    if (!apiBaseUrl) throw new Error('apiBaseUrl is required for getRoomsForOrganization');
    const base = String(apiBaseUrl).replace(/\/$/, '');
    const url = `${base}/api/Room/GetRoomsForOrganization`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        token,
        Referer: base + '/',
    };
    // Use shared getJson so the global API logger captures this call
    const res = await getJson(url, 10000, headers);
    // suppressed debug log for getRoomsForOrganization
    return res;
}

export async function getAppointmentTypeNameAndID(token: string, apiBaseUrl?: string) {
    if (!apiBaseUrl) throw new Error('apiBaseUrl is required for getAppointmentTypeNameAndID');
    const base = String(apiBaseUrl).replace(/\/$/, '');
    const url = `${base}/api/ApptypeCasepackMap/GetApptypeCasepackMapData`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        token,
        Referer: base + '/',
    };
    const res = await getJson(url, 10000, headers);
    // suppressed debug log for getAppointmentTypeNameAndID
    return res;
}

export async function getPhysicianNameAndID(token: string, apiBaseUrl?: string, orgId?: number, includeInactive = false) {
    if (!apiBaseUrl) throw new Error('apiBaseUrl is required for getPhysicianNameAndID');
    if (orgId === undefined) throw new Error('orgId is required for getPhysicianNameAndID');
    const base = String(apiBaseUrl).replace(/\/$/, '');
    const url = `${base}/api/StaffList/GetStaffForOrganization/${orgId}/${includeInactive ? 'true' : 'false'}`;
    const headers: Record<string, string> = {
        Accept: 'application/json',
        token,
        Referer: base + '/',
    };
    const res = await getJson(url, 10000, headers);
    // suppressed debug log for getPhysicianNameAndID
    return res;
}

export async function getFeeSchedules(token: string, apiBaseUrl?: string, extraHeaders?: Record<string,string>) {
    if (!apiBaseUrl) throw new Error('apiBaseUrl is required for getFeeSchedules');
    const base = String(apiBaseUrl).replace(/\/+$/, '');
    const url = `${base}/api/FeeSchedule/GetFeeSchedules/`;
    const defaultHeaders: Record<string,string> = Object.assign({
        Accept: 'text/json',
        priority: 'u=1, i',
        token,
        Referer: base + '/',
    }, extraHeaders || {});

    // Try shared getJson first for logging
    try {
        const res = await getJson(url, 15000, defaultHeaders as any);
        // suppressed debug log for getFeeSchedules
        return res;
    } catch (err) {
        // fallback to axios for more control
        const axiosRes = await axios.get(url, { headers: defaultHeaders, timeout: 15000, responseType: 'json' });
        return axiosRes.data;
    }
}

export async function getPeriodBatches(token: string, apiBaseUrl?: string, extraHeaders?: Record<string,string>) {
    if (!apiBaseUrl) throw new Error('apiBaseUrl is required for getPeriodBatches');
    const base = String(apiBaseUrl).replace(/\/+$/, '');
    const url = `${base}/api/PeriodBatch/GetPeriodBatch/false`;
    const defaultHeaders: Record<string,string> = Object.assign({
        Accept: 'application/json',
        priority: 'u=1, i',
        token,
        Referer: base + '/',
    }, extraHeaders || {});

    try {
        const res = await getJson(url, 15000, defaultHeaders as any);
        return res;
    } catch (err) {
        const axiosRes = await axios.get(url, { headers: defaultHeaders, timeout: 15000, responseType: 'json' });
        return axiosRes.data;
    }
}

export async function getInsuranceCarriers(token: string, apiBaseUrl?: string, extraHeaders?: Record<string,string>) {
    if (!apiBaseUrl) throw new Error('apiBaseUrl is required for getInsuranceCarriers');
    const base = String(apiBaseUrl).replace(/\/+$|\/$/g, '').replace(/\/$/, '');
    const url = `${base}/api/InsuranceCarrierObject/GetInsuranceCarriers`;
    const defaultHeaders: Record<string,string> = Object.assign({
        Accept: 'application/json',
        priority: 'u=1, i',
        token,
        Referer: base + '/',
    }, extraHeaders || {});

    try {
        const res = await getJson(url, 15000, defaultHeaders as any);
        return res;
    } catch (err) {
        const axiosRes = await axios.get(url, { headers: defaultHeaders, timeout: 15000, responseType: 'json' });
        return axiosRes.data;
    }
}

// Anesthesia Billing orgs: external facilities are used as the case place of service
export async function getExternalFacilities(token: string, apiBaseUrl: string | undefined, orgId: number, extraHeaders?: Record<string,string>) {
    if (!apiBaseUrl) throw new Error('apiBaseUrl is required for getExternalFacilities');
    const base = String(apiBaseUrl).replace(/\/+$/, '');
    const url = `${base}/api/AnesthesiaBillingConfiguration/Get/ExternalFacilities/List/${orgId}/false`;
    const headers: Record<string,string> = Object.assign({
        Accept: 'application/json',
        token,
        Referer: base + '/',
    }, extraHeaders || {});
    return getJson(url, 15000, headers as any);
}

export async function getGeneralLedgerAccounts(token: string, apiBaseUrl?: string, extraHeaders?: Record<string,string>) {
    if (!apiBaseUrl) throw new Error('apiBaseUrl is required for getGeneralLedgerAccounts');
    const base = String(apiBaseUrl).replace(/\/+$/, '');
    const url = `${base}/api/facility/business/transaction-codes/general-ledger-accounts/is-active/false`;
    const defaultHeaders: Record<string,string> = Object.assign({
        Accept: 'application/json',
        priority: 'u=1, i',
        token,
        Referer: base + '/',
    }, extraHeaders || {});

    try {
        const res = await getJson(url, 15000, defaultHeaders as any);
        return res;
    } catch (err) {
        const axiosRes = await axios.get(url, { headers: defaultHeaders, timeout: 15000, responseType: 'json' });
        return axiosRes.data;
    }
}

export async function createPeriod(token: string, apiBaseUrl?: string, periodPayload?: any, extraHeaders?: Record<string,string>) {
    if (!apiBaseUrl) throw new Error('apiBaseUrl is required for createPeriod');
    const base = String(apiBaseUrl).replace(/\/+$/, '');
    const url = `${base}/api/PeriodConfig/UpsertCheckedPeriodObject`;
    const headers: Record<string,string> = Object.assign({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        priority: 'u=1, i',
        token,
        Referer: base + '/',
    }, extraHeaders || {});
    try {
        const axiosRes = await axios.post(url, periodPayload || {}, { headers, timeout: 15000, responseType: 'json' });
        return axiosRes.data;
    } catch (err) {
        throw err;
    }
}

export async function createBatch(token: string, apiBaseUrl?: string, batchPayload?: any, extraHeaders?: Record<string,string>) {
    if (!apiBaseUrl) throw new Error('apiBaseUrl is required for createBatch');
    const base = String(apiBaseUrl).replace(/\/+$/, '');
    const url = `${base}/api/PeriodBatch/InsertBatch`;
    const headers: Record<string,string> = Object.assign({
        Accept: 'text/json',
        'Content-Type': 'text/json',
        priority: 'u=1, i',
        token,
        Referer: base + '/',
    }, extraHeaders || {});
    try {
        const axiosRes = await axios.post(url, batchPayload || {}, { headers, timeout: 15000, responseType: 'json' });
        return axiosRes.data;
    } catch (err) {
        throw err;
    }
}

export default {
    requestRecordLock,
    releaseRecordLock,
    getFeeSchedules,
    getInsuranceCarriers,
    getGeneralLedgerAccounts,
};
