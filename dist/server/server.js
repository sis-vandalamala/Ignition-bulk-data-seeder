"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const auth_1 = require("./auth");
const api_1 = require("../src/utils/api");
const api_2 = require("../src/utils/api");
const app = (0, express_1.default)();
app.use(express_1.default.json());
// Session middleware: capture token from incoming requests and store it on app.locals
app.use((req, _res, next) => {
    try {
        const headerToken = (req.headers && req.headers['token']) || undefined;
        const bodyToken = req.body && req.body.token ? req.body.token : undefined;
        const token = headerToken || bodyToken;
        if (token) {
            const t = Array.isArray(token) ? token[0] : token;
            req.app.locals.token = t;
        }
    }
    catch (e) {
        // ignore
    }
    next();
});
// serve UI
app.use('/ui', express_1.default.static(path_1.default.join(__dirname, '..', 'src', 'ui')));
app.post('/login', async (req, res) => {
    const { username, password, facilityId, apiUrl } = req.body || {};
    try {
        // ensure a place to collect logs for this app instance
        req.app.locals.apiLogs = req.app.locals.apiLogs || [];
        const instanceLogs = req.app.locals.apiLogs;
        const logger = (entry) => { try {
            instanceLogs.push(entry);
        }
        catch (e) { } };
        const out = await (0, auth_1.loginUser)(apiUrl, username, password, facilityId, logger);
        // if login returned a token, store it on the server app locals so server-side calls can reuse it
        if (out && out.ok && out.token) {
            req.app.locals.token = out.token;
            req.app.locals.orgId = out.orgId;
        }
        // include any recorded logs from login in the response
        res.json(Object.assign({}, out, { logs: instanceLogs }));
    }
    catch (e) {
        res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
});
app.post('/logout', (req, res) => {
    const { token } = req.body || {};
    res.json((0, auth_1.logoutUser)(token));
});
app.post('/seed', (req, res) => {
    // Capture logs for this run and return them to the UI when complete
    const token = req.app.locals.token || req.headers.token || null;
    console.log('[server] /seed called', { body: req.body, token: !!token });
    const logs = [];
    const logger = (entry) => {
        try {
            logs.push(entry);
        }
        catch (e) { }
    };
    // set global logger so postJson calls anywhere will be captured
    (0, api_1.setGlobalApiLogger)(logger);
    // For now, simulate work or run demo calls if requested. In future, wire the real seeder here.
    (async () => {
        try {
            if (req.body && req.body.runDemoCalls && req.body.demoUrl) {
                // perform a demo POST to the provided demoUrl to generate logs
                try {
                    await (0, api_2.postJson)(req.body.demoUrl, { ping: true }, 10000, { token }, logger);
                }
                catch (e) {
                    // ignore demo call errors; they will be logged by postJson
                }
            }
            else {
                // simulate some async work so UI has time to receive logs
                await new Promise(r => setTimeout(r, 500));
            }
        }
        finally {
            // remove global logger after run to avoid cross-request leakage
            (0, api_1.setGlobalApiLogger)(undefined);
            // send logs back to client
            res.json({ ok: true, message: 'seed run finished (stub)', tokenPresent: !!token, logs });
        }
    })();
});
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => console.log(`Server started at http://localhost:${port}/ui/index.html`));
exports.default = app;
