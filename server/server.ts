import express from 'express';
import path from 'path';
import { loginUser, logoutUser } from './auth';
import { setGlobalApiLogger } from '../src/utils/api';
import { postJson } from '../src/utils/api';
import { createBasicPatients } from '../src/services/patient.service';
import { createInsurance, extractInsuranceInsertOverrides } from '../src/services/insurance.service';
import type { InsuranceInsertOverrides } from '../src/services/insurance.service';
import { getRoomsForOrganization, getAppointmentTypeNameAndID, getPhysicianNameAndID, getFeeSchedules, getPeriodBatches, getInsuranceCarriers } from '../src/services/support.service';

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
				let insuranceResult: any = null;
				let insuranceResults: any[] | null = null;
				let insuranceOverrides: InsuranceInsertOverrides | undefined;
				let insuranceOverridesList: InsuranceInsertOverrides[] | undefined;
				const shouldCreateInsurance = (opts.mode !== 'auto') && String(opts.insuranceType || '').toLowerCase() === 'create';
				if (opts.mode === 'auto') {
					// Auto mode: create a single insurance with random suffix and map to all cases
					const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
					const one = await createInsurance({
						apiBaseUrl: opts.apiUrl || opts.url,
						token,
						suffix: rand,
						timeoutMs: 60000,
						extraHeaders,
						logFn: logger,
					});
					insuranceResult = one;
					insuranceOverrides = extractInsuranceInsertOverrides(one);
				} else if (shouldCreateInsurance) {
					if (!opts.suffix || !String(opts.suffix).trim()) throw new Error('Suffix is required to create insurance');
					const pr: string = String(opts.insurancePriority || 'primary').toLowerCase();
					const count = pr === 'p+s+t' ? 3 : (pr === 'p+s' ? 2 : 1);
					insuranceResults = [];
					for (let i = 1; i <= count; i += 1) {
						const suffix = `${String(opts.suffix).trim()}v${i}`;
						const one = await createInsurance({
							apiBaseUrl: opts.apiUrl || opts.url,
							token,
							suffix,
							timeoutMs: 60000,
							extraHeaders,
							logFn: logger,
						});
						insuranceResults.push(one);
					}
					// For backward-compat also expose the first result
					insuranceResult = insuranceResults[0];
					// Build overrides list for patient-insert mapping
					insuranceOverridesList = insuranceResults.map(r => extractInsuranceInsertOverrides(r)).filter(Boolean) as InsuranceInsertOverrides[];
					// Keep single override for legacy path
					insuranceOverrides = insuranceOverridesList[0];
				}
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
				// forward CPT amounts mapping from UI so charge entry can use per-code amounts
				cptAmounts: opts.cptAmounts,
				dos: opts.dos,
					logFn: logger,
					extraHeaders,
					username: opts.username,
					flowDepth: typeof opts.flowDepth === 'number' ? opts.flowDepth : undefined,
					mode: opts.mode,
					periodBatchMode: opts.mode === 'auto' ? 'auto' : (opts.periodBatch as 'select' | 'create' | undefined),
					selectedPeriodId: typeof opts.periodId !== 'undefined' ? Number(opts.periodId) : undefined,
					selectedBatchId: typeof opts.batchId !== 'undefined' ? Number(opts.batchId) : undefined,
					insuranceInsertOverrides: insuranceOverrides,
					insuranceInsertOverridesList: insuranceOverridesList,
					insuranceType: opts.mode === 'auto' ? 'create' : opts.insuranceType,
					insuranceCreateResult: insuranceResult || undefined,
					insuranceCreateResults: insuranceResults || undefined,
				});
				const runElapsedMs = Date.now() - runStart;
				return res.json({ ok: true, result: svcRes, insuranceResult, insuranceResults, tokenPresent: !!token, logs, runElapsedMs });
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
					// suppressed support-data rooms fetched log
				} catch (e: any) { /* suppressed getRoomsForOrganization error */ }

				try {
					appointmentTypes = await getAppointmentTypeNameAndID(token as any, apiUrl);
					// suppressed support-data appointmentTypes fetched log
				} catch (e: any) { /* suppressed getAppointmentTypeNameAndID error */ }

				try {
					physicians = await getPhysicianNameAndID(token as any, apiUrl, Number(facilityId), false);
					// suppressed support-data physicians fetched log
				} catch (e: any) { /* suppressed getPhysicianNameAndID error */ }

					try {
						// Fetch fee schedules (CPT catalog) so UI can populate CPT dropdown
						const feeSchedule = await getFeeSchedules(token as any, apiUrl);
						// suppressed support-data feeSchedule fetched log
						// attach to response container
						(physicians as any).__feeSchedule = feeSchedule; // keep local reference (not used elsewhere)
					} catch (e: any) { /* suppressed getFeeSchedules error */ }

					try {
						// Fetch periods and batches
						const pb = await getPeriodBatches(token as any, apiUrl);
						// pb is expected to be an array of period objects each having a `batches` array
						const filtered = Array.isArray(pb) ? pb.filter((p: any) => Array.isArray(p.batches) && p.batches.length > 0) : [];
						const periods = filtered.map((p: any) => ({ periodId: p.periodId, label: p.label ?? p.periodName, value: p.periodId, batches: p.batches }));
						const batches = filtered.flatMap((p: any) => (p.batches || []).map((b: any) => Object.assign({}, b, { periodId: p.periodId })));
						// attach to response via physicians container to avoid changing structure earlier? we'll return separately below
						(physicians as any).__periods = periods;
						(physicians as any).__batches = batches;
					} catch (e: any) { /* suppressed getPeriodBatches error */ }

					try {
						// Fetch insurance carriers
						const ins = await getInsuranceCarriers(token as any, apiUrl);
						(physicians as any).__insurances = ins;
					} catch (e: any) { /* suppressed getInsuranceCarriers error */ }

					// suppressed support-data captured logs output
					// include feeSchedule, periods and batches if available (stored on physicians.__* above)
					const feeSchedule = (physicians as any && (physicians as any).__feeSchedule) ? (physicians as any).__feeSchedule : undefined;
					const periods = (physicians as any && (physicians as any).__periods) ? (physicians as any).__periods : undefined;
					const batches = (physicians as any && (physicians as any).__batches) ? (physicians as any).__batches : undefined;
					const insurances = (physicians as any && (physicians as any).__insurances) ? (physicians as any).__insurances : undefined;
					return res.json({ ok: true, rooms, appointmentTypes, physicians, feeSchedule, periods, batches, insurances, logs });
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
