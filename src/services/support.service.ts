import axios from 'axios';

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

export default {
    requestRecordLock,
    releaseRecordLock,
};
