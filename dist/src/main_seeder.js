"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPatient = createPatient;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const api_1 = require("./utils/api");
async function createPatient(opts, logFn) {
    if (!opts || !opts.apiUrl)
        return { ok: false, error: 'apiUrl required' };
    const apiUrl = String(opts.apiUrl).replace(/\/$/, '');
    const tplPath = path_1.default.join(__dirname, 'core', 'patients', 'patient.payload.json');
    let template = {};
    try {
        template = JSON.parse(fs_1.default.readFileSync(tplPath, 'utf8'));
    }
    catch (e) {
        template = {};
    }
    const payload = Object.assign({}, template, opts.overrides || {});
    if (opts.suffix && payload.firstName)
        payload.firstName = `${payload.firstName}_${opts.suffix}`;
    if (opts.suffix && payload.lastName)
        payload.lastName = `${payload.lastName}_${opts.suffix}`;
    const url = `${apiUrl}/api/PatientData/Gemini/CreatePatient/2030`;
    const headers = { 'Content-Type': 'text/json', Accept: 'text/json' };
    if (opts.token)
        headers.token = opts.token;
    try {
        const res = await (0, api_1.postJson)(url, payload, 30000, headers, logFn);
        return { ok: true, requestPayload: payload, response: res };
    }
    catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
    }
}
exports.default = createPatient;
