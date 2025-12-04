import express from 'express';
import path from 'path';
import { loginUser, logoutUser } from './auth';
import { setGlobalApiLogger } from '../src/utils/api';
import { postJson } from '../src/utils/api';
import { createBasicPatients } from '../src/services/patient.service';
import { getRoomsForOrganization, getAppointmentTypeNameAndID, getPhysicianNameAndID, getFeeSchedules } from '../src/services/support.service';

const app = express();
app.use(express.json());

// Session middleware: capture token from incoming requests and store it on app.locals
app.use((req, _res, next) => {
	try {
		const headerToken = (req.headers && (req.headers as any)['token']) || undefined;
		const bodyToken = req.body && req.body.token ? req.body.token : undefined;
		const token = headerToken || bodyToken;
		if (token) {
			const t = Array.isArray(token) ? token[0] : token;
			(req.app.locals as any).token = t;
		}
	} catch (e) {
		// ignore
	}
	next();
});

// serve UI
app.use('/ui', express.static(path.join(__dirname, '..', 'src', 'ui')));

app.post('/login', async (req, res) => {
	const { username, password, facilityId, apiUrl } = req.body || {};
	try {
		// ensure a fresh place to collect logs for this login request (clear previous)
		(req.app.locals as any).apiLogs = [];
		const instanceLogs = (req.app.locals as any).apiLogs;
		const logger = (entry: any) => { try { instanceLogs.push(entry); } catch (e) {} };

		const out = await loginUser(apiUrl, username, password, facilityId, logger);
		// if login returned a token, store it on the server app locals so server-side calls can reuse it
		if (out && out.ok && out.token) {
			(req.app.locals as any).token = out.token;
			(req.app.locals as any).orgId = out.orgId;
		}
		// include any recorded logs from login in the response
		res.json(Object.assign({}, out, { logs: instanceLogs }));
	} catch (e: any) {
		res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
	}
});

app.post('/logout', (req, res) => {
	const { token } = req.body || {};
	res.json(logoutUser(token));
});

app.post('/seed', (req, res) => {
	// Capture logs for this run and return them to the UI when complete
	const token = (req.app.locals as any).token || (req.headers as any).token || null;

	const logs: Array<any> = [];
	const logger = (entry: any) => {
		try { logs.push(entry); } catch (e) {}
	};

	// set global logger so postJson calls anywhere will be captured
	setGlobalApiLogger(logger);

	// For now, parse opts and call appropriate action
	(async () => {
		try {
			const opts = req.body && req.body.opts ? req.body.opts : {};
			if (opts && opts.action === 'createBasicPatients') {
				const runStart = Date.now();
				// collect relevant headers from the incoming request to mimic UI behavior
				const incoming = req.headers || {};
				const extraHeaders: Record<string, string> = {};
				const headerKeys = ['accept', 'content-type', 'origin', 'referer', 'user-agent', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'priority'];
				headerKeys.forEach(k => {
					const v = (incoming as any)[k];
					if (v) extraHeaders[k] = Array.isArray(v) ? v[0] : String(v);
				});
				// Only forward appointment type overrides if an ID is present
				const hasApptId = typeof opts.appointmentTypeId === 'number' && !Number.isNaN(opts.appointmentTypeId);
				// determine if physician override provided
				const hasPhysId = typeof opts.physicianId === 'number' && !Number.isNaN(opts.physicianId);
				const svcRes = await createBasicPatients({
					apiBaseUrl: opts.apiUrl || opts.url,
					token,
					suffix: opts.suffix,
					count: Number(opts.count) || 1,
					concurrency: opts.concurrency,
					facilityId: opts.facilityId,
					roomIdOverride: opts.roomId,
					roomNameOverride: opts.roomName,
					appointmentTypeIdOverride: hasApptId ? opts.appointmentTypeId : undefined,
					appointmentTypeNameOverride: hasApptId ? opts.appointmentTypeName : undefined,
				physicianIdOverride: hasPhysId ? opts.physicianId : undefined,
				physicianNameOverride: hasPhysId ? opts.physician : undefined,
				feeScheduleOverride: opts.feeScheduleOverride,
				dos: opts.dos,
					logFn: logger,
					extraHeaders,
					username: opts.username,
					flowDepth: typeof opts.flowDepth === 'number' ? opts.flowDepth : undefined,
				});
				const runElapsedMs = Date.now() - runStart;
				return res.json({ ok: true, result: svcRes, tokenPresent: !!token, logs, runElapsedMs });
			}

			// fallback demo behavior
			if (req.body && req.body.runDemoCalls && req.body.demoUrl) {
				try { await postJson(req.body.demoUrl, { ping: true }, 10000, { token }, logger); } catch (e) {}
			} else {
				await new Promise(r => setTimeout(r, 500));
			}

			return res.json({ ok: true, message: 'seed run finished (stub)', tokenPresent: !!token, logs });
		} finally {
			setGlobalApiLogger(undefined);
		}
	})();
});

// progress polling endpoint removed

// Support data endpoint: fetch rooms, appointment types, physicians for given facility/org
app.post('/support-data', async (req, res) => {
	try {
		const token = (req.app.locals as any).token || (req.headers as any).token || null;
		const apiUrl = (req.body && req.body.apiUrl) ? req.body.apiUrl : (req.body && req.body.apiBaseUrl ? req.body.apiBaseUrl : undefined);
		const facilityId = (req.body && (req.body.facilityId ?? req.body.orgId)) as number | undefined;
		if (!apiUrl) return res.status(400).json({ ok: false, error: 'apiUrl is required' });
		if (facilityId === undefined) return res.status(400).json({ ok: false, error: 'facilityId (orgId) is required' });

		const logs: Array<any> = [];
		const logger = (entry: any) => { try { logs.push(entry); } catch (e) {} };
		try {
			setGlobalApiLogger(logger);
			let rooms: any = null;
			let appointmentTypes: any = null;
			let physicians: any = null;
			try {
				try {
					rooms = await getRoomsForOrganization(token as any, apiUrl);
					try { console.log('[support-data] rooms fetched, count=', Array.isArray(rooms) ? rooms.length : 'obj'); } catch (e) {}
				} catch (e: any) { console.error('[support-data] getRoomsForOrganization error', e && e.message ? e.message : e); }

				try {
					appointmentTypes = await getAppointmentTypeNameAndID(token as any, apiUrl);
					try { console.log('[support-data] appointmentTypes fetched, count=', Array.isArray(appointmentTypes) ? appointmentTypes.length : 'obj'); } catch (e) {}
				} catch (e: any) { console.error('[support-data] getAppointmentTypeNameAndID error', e && e.message ? e.message : e); }

				try {
					physicians = await getPhysicianNameAndID(token as any, apiUrl, Number(facilityId), false);
					try { console.log('[support-data] physicians fetched, count=', Array.isArray(physicians) ? physicians.length : 'obj'); } catch (e) {}
				} catch (e: any) { console.error('[support-data] getPhysicianNameAndID error', e && e.message ? e.message : e); }

					try {
						// Fetch fee schedules (CPT catalog) so UI can populate CPT dropdown
						const feeSchedule = await getFeeSchedules(token as any, apiUrl);
						try { console.log('[support-data] feeSchedule fetched, count=', Array.isArray(feeSchedule) ? feeSchedule.length : 'obj'); } catch (e) {}
						// attach to response container
						(physicians as any).__feeSchedule = feeSchedule; // keep local reference (not used elsewhere)
					} catch (e: any) { console.error('[support-data] getFeeSchedules error', e && e.message ? e.message : e); }

					try { console.log('[support-data] captured logs:', logs.length); if (logs.length) console.log('[support-data] sample log:', logs[0]); } catch (e) {}
					// include feeSchedule if available (stored on physicians.__feeSchedule above)
					const feeSchedule = (physicians as any && (physicians as any).__feeSchedule) ? (physicians as any).__feeSchedule : undefined;
					return res.json({ ok: true, rooms, appointmentTypes, physicians, feeSchedule, logs });
			} finally {
				try { setGlobalApiLogger(undefined); } catch (e) {}
			}
		} finally {
			try { setGlobalApiLogger(undefined); } catch (e) {}
		}
	} catch (e: any) {
		try { setGlobalApiLogger(undefined); } catch (ee) {}
		return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
	}
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {});

export default app;
