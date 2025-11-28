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
    try { const first = Array.isArray(res) ? res[0] : res; console.log('[getRoomsForOrganization] response:', first); } catch (e) {}
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
    try { const first = Array.isArray(res) ? res[0] : res; console.log('[getAppointmentTypeNameAndID] response:', first); } catch (e) {}
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
    try { const first = Array.isArray(res) ? res[0] : res; console.log('[getPhysicianNameAndID] response:', first); } catch (e) {}
    return res;
}

export default {
    requestRecordLock,
    releaseRecordLock,
};
