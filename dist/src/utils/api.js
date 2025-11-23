"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setGlobalApiLogger = setGlobalApiLogger;
exports.postJson = postJson;
const axios_1 = __importDefault(require("axios"));
let globalLogger = undefined;
function setGlobalApiLogger(fn) {
    globalLogger = fn;
}
async function postJson(url, payload, timeout = 5000, headers, logFn) {
    const start = Date.now();
    const opts = { timeout };
    if (headers && Object.keys(headers).length)
        opts.headers = headers;
    try {
        const res = await axios_1.default.post(url, payload, opts);
        const duration = Date.now() - start;
        const entry = { url, method: 'POST', status: res.status, durationMs: duration, timestamp: new Date().toISOString() };
        try {
            if (logFn)
                logFn(entry);
        }
        catch (e) { }
        try {
            if (globalLogger)
                globalLogger(entry);
        }
        catch (e) { }
        return res.data;
    }
    catch (err) {
        const duration = Date.now() - start;
        const entry = { url, method: 'POST', status: 'error', durationMs: duration, error: err && err.message ? err.message : String(err), timestamp: new Date().toISOString() };
        try {
            if (logFn)
                logFn(entry);
        }
        catch (e) { }
        try {
            if (globalLogger)
                globalLogger(entry);
        }
        catch (e) { }
        throw err;
    }
}
