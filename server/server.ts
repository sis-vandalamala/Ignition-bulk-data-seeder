import express from 'express';
import path from 'path';
import { loginUser, logoutUser } from './auth';
import { setGlobalApiLogger, describeApiError } from '../src/utils/api';
import { postJson } from '../src/utils/api';
import { createBasicPatients, CASE_STAGE_LABELS, isUsableAppointmentType } from '../src/services/patient.service';
import { createInsurance, extractInsuranceInsertOverrides } from '../src/services/insurance.service';
import type { InsuranceInsertOverrides } from '../src/services/insurance.service';
import { getRoomsForOrganization, getAppointmentTypeNameAndID, getPhysicianNameAndID, getFeeSchedules, getPeriodBatches, getInsuranceCarriers, getGeneralLedgerAccounts } from '../src/services/support.service';
import { createContracts } from '../src/services/contract.service';
import { createCaseFlags, getCaseFlagColors } from '../src/services/caseFlag.service';
import { createTransactionCodes } from '../src/services/transactionCode.service';

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
	const { username, password, facilityId, apiUrl, orgType } = req.body || {};
	try {
		// ensure a fresh place to collect logs for this login request (clear previous)
		(req.app.locals as any).apiLogs = [];
		const instanceLogs = (req.app.locals as any).apiLogs;
		const logger = (entry: any) => { try { instanceLogs.push(entry); } catch (e) {} };

		const out = await loginUser(apiUrl, username, password, facilityId, logger, orgType);
		// if login returned a token, store it on the server app locals so server-side calls can reuse it
		if (out && out.ok && out.token) {
			(req.app.locals as any).token = out.token;
			(req.app.locals as any).orgId = out.orgId;
			(req.app.locals as any).isAnesthesiaBilling = !!(out as any).isAnesthesiaBilling;
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

// ---------------------------------------------------------------------------
// Case seeding
//
// Each Workflow Action is the tracker the cases should land in. It decides how far the
// per-case flow runs and whether insurance is attached (insured vs self-pay charges):
//   Create Case -> [Financial Clearance] -> Discharge -> [Cases to Code] -> Code -> [Charge Entry]
//   -> Charge Entry -> [Insurance Billing + Balance/Reconciliation] (insured) or [Patient Statements] (self-pay)
// ---------------------------------------------------------------------------
type TrackerTarget = { label: string; flowDepth: number; insurance: 'create' | 'none' | 'manual' };
const TRACKER_TARGETS: Record<string, TrackerTarget> = {
	financialClearance: { label: 'Financial Clearance Tracker', flowDepth: 0, insurance: 'create' },
	casesToCodeTracker: { label: 'Cases to Code Tracker', flowDepth: 1, insurance: 'create' },
	chargeEntryTracker: { label: 'Charge Entry Tracker', flowDepth: 2, insurance: 'create' },
	insuranceBilling: { label: 'Insurance Billing Tracker', flowDepth: 3, insurance: 'create' },
	balanceReconciliation: { label: 'Balance/Reconciliation Tracker', flowDepth: 3, insurance: 'create' },
	patientStatements: { label: 'Patient Statements Tracker', flowDepth: 3, insurance: 'none' },
	// legacy action names (older UI builds / scripts)
	createBasicPatients: { label: 'Financial Clearance Tracker', flowDepth: 0, insurance: 'create' },
	dischargeCases: { label: 'Cases to Code Tracker', flowDepth: 1, insurance: 'create' },
	casesToCode: { label: 'Charge Entry Tracker', flowDepth: 2, insurance: 'create' },
	chargeEntry: { label: 'Balance/Reconciliation Tracker', flowDepth: 3, insurance: 'create' },
	patientStatementsTracker: { label: 'Patient Statements Tracker', flowDepth: 3, insurance: 'none' },
};
const MANUAL_DEPTH_TRACKER = ['Financial Clearance Tracker', 'Cases to Code Tracker', 'Charge Entry Tracker', 'Insurance Billing / Balance-Reconciliation Tracker'];

// Anesthesia Billing desktop trackers. Depth 1 = Verification Complete + Clinical Documentation (Performed),
// which lands the case in the combined Coding/Charge Entry tracker. Anes coding/charge entry is not automated yet.
const ANES_TRACKER_TARGETS: Record<string, TrackerTarget> = {
	financialClearance: { label: 'Financial Clearance Tracker', flowDepth: 0, insurance: 'create' },
	anesCodingChargeEntry: { label: 'Coding/Charge Entry Tracker', flowDepth: 1, insurance: 'create' },
	createBasicPatients: { label: 'Financial Clearance Tracker', flowDepth: 0, insurance: 'create' },
	casesToCodeTracker: { label: 'Coding/Charge Entry Tracker', flowDepth: 1, insurance: 'create' },
	chargeEntryTracker: { label: 'Coding/Charge Entry Tracker', flowDepth: 1, insurance: 'create' },
	dischargeCases: { label: 'Coding/Charge Entry Tracker', flowDepth: 1, insurance: 'create' },
	casesToCode: { label: 'Coding/Charge Entry Tracker', flowDepth: 1, insurance: 'create' },
};
const ANES_MAX_DEPTH = 1;

type SeedFailure = { index: number; patientName?: string; patientId?: number; caseSummaryId?: number; stage?: string; error: string };
type SeedJob = {
	runId: string;
	status: 'running' | 'finished' | 'error';
	targetTracker: string;
	total: number;
	completed: number;
	passed: number;
	failed: number;
	inStage: Record<number, string>; // case index -> current stage label (in-flight cases only)
	failures: SeedFailure[];
	warnings: string[];
	logs: any[];
	startedAt: number;
	finishedAt?: number;
	error?: string;
	response?: any; // final payload (same shape the UI used to get from POST /seed)
};
const seedJobs = new Map<string, SeedJob>();
const MAX_KEPT_JOBS = 10;
function rememberJob(job: SeedJob) {
	seedJobs.set(job.runId, job);
	while (seedJobs.size > MAX_KEPT_JOBS) {
		const oldest = seedJobs.keys().next().value as string | undefined;
		if (!oldest) break;
		seedJobs.delete(oldest);
	}
}
function runningJob() {
	for (const j of seedJobs.values()) if (j.status === 'running') return j;
	return undefined;
}
function compactResult(r: any) {
	if (!r) return r;
	return {
		index: r.index,
		status: r.status,
		patientName: r.patientName,
		patientId: r.patientId,
		caseSummaryId: r.caseSummaryId,
		completedStages: r.completedStages,
		failedStage: r.failedStage,
		failedStageLabel: r.failedStageLabel,
		error: r.error,
		warnings: r.warnings,
		insertInsuranceError: r.insertInsuranceError,
	};
}

app.post('/seed', (req, res) => {
	const token = (req.app.locals as any).token || (req.headers as any).token || null;
	const opts = req.body && req.body.opts ? req.body.opts : {};
	const actionStr = String((opts && (opts as any).action) ? (opts as any).action : 'financialClearance');
	const isAnes = !!(req.app.locals as any).isAnesthesiaBilling;
	const isAuto = opts.mode === 'auto';
	const target = isAnes ? ANES_TRACKER_TARGETS[actionStr] : TRACKER_TARGETS[actionStr];
	if (!target) {
		const msg = isAnes && TRACKER_TARGETS[actionStr]
			? `"${TRACKER_TARGETS[actionStr].label}" is not supported for Anesthesia Billing orgs yet — Anes coding/charge entry is not automated. Choose Financial Clearance or Coding/Charge Entry.`
			: `Unknown workflow action "${actionStr}"`;
		return res.status(400).json({ ok: false, error: msg });
	}
	const busy = runningJob();
	if (busy) return res.status(409).json({ ok: false, error: `A seed run is already in progress (${busy.completed}/${busy.total} cases done). Wait for it to finish.`, runId: busy.runId });

	const requestedDepth = isAuto ? target.flowDepth : (typeof opts.flowDepth === 'number' ? opts.flowDepth : target.flowDepth);
	const total = Math.max(1, Number(opts.count) || 1);
	const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
	const job: SeedJob = {
		runId,
		status: 'running',
		targetTracker: isAuto ? target.label : (isAnes
			? (requestedDepth >= 1 ? 'Coding/Charge Entry Tracker' : 'Financial Clearance Tracker')
			: (MANUAL_DEPTH_TRACKER[Math.max(0, Math.min(3, requestedDepth))] || target.label)),
		total,
		completed: 0,
		passed: 0,
		failed: 0,
		inStage: {},
		failures: [],
		warnings: [],
		logs: [],
		startedAt: Date.now(),
	};
	if (!isAnes && !isAuto && requestedDepth >= 3) {
		job.targetTracker = String(opts.insuranceType || '').toLowerCase() === 'create' ? 'Insurance Billing / Balance-Reconciliation Tracker' : 'Patient Statements Tracker';
	}
	if (isAnes && requestedDepth > ANES_MAX_DEPTH) {
		job.warnings.push('Anesthesia Billing org: coding/charge entry is not automated yet, so cases stop in the Coding/Charge Entry tracker (verified + documented as Performed).');
	}
	rememberJob(job);
	const logger = (entry: any) => { try { job.logs.push(entry); } catch (e) {} };
	// set global logger so postJson calls anywhere will be captured
	setGlobalApiLogger(logger);
	// Respond right away; the UI polls GET /seed/status for live progress
	res.json({ ok: true, runId, total, targetTracker: job.targetTracker, warnings: job.warnings });

	(async () => {
		const runStart = Date.now();
		try {
			// collect relevant headers from the incoming request to mimic UI behavior
			const incoming = req.headers || {};
			const extraHeaders: Record<string, string> = {};
			const headerKeys = ['accept', 'content-type', 'origin', 'referer', 'user-agent', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'priority'];
			headerKeys.forEach(k => {
				const v = (incoming as any)[k];
				if (v) extraHeaders[k] = Array.isArray(v) ? v[0] : String(v);
			});
			// Only forward appointment type / physician overrides if an ID is present
			const hasApptId = typeof opts.appointmentTypeId === 'number' && !Number.isNaN(opts.appointmentTypeId);
			const hasPhysId = typeof opts.physicianId === 'number' && !Number.isNaN(opts.physicianId);
			let insuranceResult: any = null;
			let insuranceResults: any[] | null = null;
			let insuranceOverrides: InsuranceInsertOverrides | undefined;
			let insuranceOverridesList: InsuranceInsertOverrides[] | undefined;
			const shouldCreateInsurance = !isAuto && String(opts.insuranceType || '').toLowerCase() === 'create';
			const autoCreateInsurance = isAuto && target.insurance === 'create';
			if (autoCreateInsurance) {
				// Auto mode: create a single insurance with random suffix and map to all cases
				const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
				const one = await createInsurance({ apiBaseUrl: opts.apiUrl || opts.url, token, suffix: rand, timeoutMs: 60000, extraHeaders, logFn: logger });
				insuranceResult = one;
				insuranceOverrides = extractInsuranceInsertOverrides(one);
			} else if (shouldCreateInsurance) {
				if (!opts.suffix || !String(opts.suffix).trim()) throw new Error('Suffix is required to create insurance');
				const pr: string = String(opts.insurancePriority || 'primary').toLowerCase();
				const count = pr === 'p+s+t' ? 3 : (pr === 'p+s' ? 2 : 1);
				insuranceResults = [];
				for (let i = 1; i <= count; i += 1) {
					const suffix = `${String(opts.suffix).trim()}v${i}`;
					const one = await createInsurance({ apiBaseUrl: opts.apiUrl || opts.url, token, suffix, timeoutMs: 60000, extraHeaders, logFn: logger });
					insuranceResults.push(one);
				}
				insuranceResult = insuranceResults[0];
				insuranceOverridesList = insuranceResults.map(r => extractInsuranceInsertOverrides(r)).filter(Boolean) as InsuranceInsertOverrides[];
				insuranceOverrides = insuranceOverridesList[0];
			}
			const svcRes: any = await createBasicPatients({
				apiBaseUrl: opts.apiUrl || opts.url,
				token,
				isAnesthesiaBilling: isAnes,
				suffix: opts.suffix,
				count: total,
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
				// Anes Billing: only case creation is supported for now (skip discharge / coding / charge entry)
				flowDepth: isAnes ? Math.min(requestedDepth, ANES_MAX_DEPTH) : requestedDepth,
				mode: opts.mode,
				periodBatchMode: isAuto ? 'auto' : (opts.periodBatch as 'select' | 'create' | undefined),
				selectedPeriodId: typeof opts.periodId !== 'undefined' ? Number(opts.periodId) : undefined,
				selectedBatchId: typeof opts.batchId !== 'undefined' ? Number(opts.batchId) : undefined,
				insuranceInsertOverrides: insuranceOverrides,
				insuranceInsertOverridesList: insuranceOverridesList,
				insuranceType: isAuto ? (autoCreateInsurance ? 'create' : 'none') : opts.insuranceType,
				insuranceCreateResult: insuranceResult || undefined,
				insuranceCreateResults: insuranceResults || undefined,
				onCaseStage: (index, stage) => { job.inStage[index] = CASE_STAGE_LABELS[stage]; },
				onCaseComplete: (r, totals) => {
					delete job.inStage[r.index];
					job.completed = totals.completed;
					job.passed = totals.passed;
					job.failed = totals.failed;
					if (r.status === 'failed') {
						job.failures.push({ index: r.index, patientName: r.patientName, patientId: r.patientId, caseSummaryId: r.caseSummaryId, stage: r.failedStageLabel, error: r.error || 'Unknown error' });
					}
				},
			});
			if (svcRes && svcRes.ok === false && svcRes.error && !Array.isArray(svcRes.results)) throw new Error(svcRes.error);
			if (svcRes && Array.isArray(svcRes.warnings)) job.warnings.push(...svcRes.warnings);
			const runElapsedMs = Date.now() - runStart;
			job.status = 'finished';
			job.finishedAt = Date.now();
			job.response = {
				ok: job.failed === 0,
				targetTracker: job.targetTracker,
				summary: svcRes ? svcRes.summary : undefined,
				warnings: job.warnings,
				result: { ok: svcRes ? svcRes.ok : false, results: (svcRes && Array.isArray(svcRes.results) ? svcRes.results : []).map(compactResult), lastPatientId: svcRes ? svcRes.lastPatientId : null },
				insuranceResult,
				insuranceResults,
				tokenPresent: !!token,
				runElapsedMs,
			};
		} catch (e: any) {
			job.status = 'error';
			job.finishedAt = Date.now();
			job.error = describeApiError(e);
			// cases that never started count as failed so the totals still add up
			const notRun = job.total - job.completed;
			if (notRun > 0) job.failed += notRun;
			job.response = { ok: false, error: job.error, targetTracker: job.targetTracker, warnings: job.warnings, runElapsedMs: Date.now() - runStart, tokenPresent: !!token };
		} finally {
			setGlobalApiLogger(undefined);
		}
	})();
});

// Live progress for a seed run. `logsFrom` lets the UI fetch only log entries it has not seen yet.
app.get('/seed/status', (req, res) => {
	const runId = String(req.query.runId || '');
	const job = seedJobs.get(runId);
	if (!job) return res.status(404).json({ ok: false, error: `Unknown runId "${runId}"`, finished: true });
	const from = Math.max(0, Number(req.query.logsFrom) || 0);
	const finished = job.status !== 'running';
	const stageCounts: Record<string, number> = {};
	Object.values(job.inStage).forEach((label) => { stageCounts[label] = (stageCounts[label] || 0) + 1; });
	res.json(Object.assign({
		runId: job.runId,
		status: job.status,
		finished,
		targetTracker: job.targetTracker,
		total: job.total,
		completed: job.completed,
		passed: job.passed,
		failed: job.failed,
		inProgress: Object.keys(job.inStage).length,
		stageCounts,
		failures: job.failures,
		warnings: job.warnings,
		error: job.error,
		elapsedMs: (job.finishedAt || Date.now()) - job.startedAt,
		logs: job.logs.slice(from),
		logsFrom: from,
		logsTotal: job.logs.length,
	}, finished ? { final: job.response } : {}));
});

// Runs a configuration seeding job (contracts / transaction codes / case flags) in the background.
// POST returns { runId } right away; GET /seed/status?runId=... gives live counts, failures and logs,
// exactly like a case seeding run (one run of any kind at a time, since API logging is global).
type ConfigHooks = { onItemStart: (index: number, stage: string) => void; onItemComplete: (r: any) => void };
function runConfigJob(req: express.Request, res: express.Response, label: string, work: (ctx: { token: string; opts: any; logger: (e: any) => void; hooks: ConfigHooks }) => Promise<{ results: any[]; route?: string }>) {
	const token = (req.app.locals as any).token || (req.headers as any).token || null;
	const opts = req.body && req.body.opts ? req.body.opts : {};
	const busy = runningJob();
	if (busy) return res.status(409).json({ ok: false, error: `Another run is in progress (${busy.completed}/${busy.total} done). Wait for it to finish.`, runId: busy.runId });
	const total = Math.max(1, Number(opts.count) || 1);
	const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
	const job: SeedJob = { runId, status: 'running', targetTracker: label, total, completed: 0, passed: 0, failed: 0, inStage: {}, failures: [], warnings: [], logs: [], startedAt: Date.now() };
	rememberJob(job);
	const logger = (entry: any) => { try { job.logs.push(entry); } catch (e) {} };
	setGlobalApiLogger(logger);
	res.json({ ok: true, runId, total, targetTracker: label, warnings: [] });

	const hooks: ConfigHooks = {
		onItemStart: (index, stage) => { job.inStage[index] = stage; },
		onItemComplete: (r) => {
			if (!r) return;
			const stage = job.inStage[r.index] || label;
			delete job.inStage[r.index];
			job.completed += 1;
			if (r.ok) job.passed += 1;
			else {
				job.failed += 1;
				job.failures.push({ index: r.index, patientName: r.contractName || r.transactionCodeName || r.caseFlagName || '', stage, error: r.error || 'Unknown error' });
			}
		},
	};
	(async () => {
		try {
			const out = await work({ token, opts, logger, hooks });
			await new Promise((r) => setImmediate(r));
			const results = out.results || [];
			const successCount = results.filter((r: any) => r.ok).length;
			const failureCount = results.length - successCount;
			// keep counts consistent even if a service did not report every item
			job.completed = results.length; job.passed = successCount; job.failed = failureCount;
			job.status = 'finished';
			job.finishedAt = Date.now();
			job.response = { ok: failureCount === 0, results: results.map(({ data, ...rest }: any) => rest), successCount, failureCount, route: out.route, targetTracker: label, runElapsedMs: job.finishedAt - job.startedAt };
		} catch (e: any) {
			await new Promise((r) => setImmediate(r));
			job.status = 'error';
			job.finishedAt = Date.now();
			job.error = e && e.message ? e.message : String(e);
			const notRun = job.total - job.completed;
			if (notRun > 0) job.failed += notRun;
			job.inStage = {};
			job.response = { ok: false, error: job.error, targetTracker: label };
		} finally {
			setGlobalApiLogger(undefined);
		}
	})();
}

app.post('/contracts', (req, res) => runConfigJob(req, res, 'Contracts', ({ token, opts, logger, hooks }) => createContracts({
	...hooks,
	apiBaseUrl: opts.apiUrl || opts.url,
	token,
	mode: opts.mode,
	count: Number(opts.count) || 1,
	isHybridContract: !!opts.isHybridContract,
	contractType: opts.contractType,
	pctBilledCharges: typeof opts.pctBilledCharges === 'number' ? opts.pctBilledCharges : undefined,
	pctAllowed: typeof opts.pctAllowed === 'number' ? opts.pctAllowed : undefined,
	effectiveDate: opts.effectiveDate || undefined,
	expiryDate: opts.expiryDate || undefined,
	notes: opts.notes,
	logFn: logger,
})));

app.post('/transaction-codes', (req, res) => runConfigJob(req, res, 'Transaction Codes', ({ token, opts, logger, hooks }) => createTransactionCodes({
	...hooks,
	apiBaseUrl: opts.apiUrl || opts.url,
	token,
	mode: opts.mode,
	count: Number(opts.count) || 1,
	type: opts.type,
	toDebit: opts.toDebit,
	toCredit: opts.toCredit,
	logFn: logger,
})));

app.post('/case-flags', (req, res) => runConfigJob(req, res, 'Case Flags', ({ token, opts, logger, hooks }) => createCaseFlags({
	...hooks,
	apiBaseUrl: opts.apiUrl || opts.url,
	token,
	// the lock and the flags belong to the org the session is bound to
	organizationId: Number((req.app.locals as any).orgId || opts.facilityId),
	mode: opts.mode,
	count: Number(opts.count) || 1,
	flagName: opts.flagName,
	abbreviation: opts.abbreviation,
	color: opts.color,
	visibility: opts.visibility,
	logFn: logger,
})));

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
					if (Array.isArray(appointmentTypes)) {
						const usable = appointmentTypes.filter((a: any) => isUsableAppointmentType(a));
						if (usable.length) appointmentTypes = usable;
					}
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

					let caseFlagColors: any = undefined;
					try {
						caseFlagColors = await getCaseFlagColors(apiUrl, token as any);
					} catch (e: any) { /* suppressed getCaseFlagColors error */ }

					let generalLedgerAccounts: any = undefined;
					try {
						// Fetch general ledger accounts (for Transaction Codes To Debit/To Credit dropdowns)
						generalLedgerAccounts = await getGeneralLedgerAccounts(token as any, apiUrl);
					} catch (e: any) { /* suppressed getGeneralLedgerAccounts error */ }

					// suppressed support-data captured logs output
					// include feeSchedule, periods and batches if available (stored on physicians.__* above)
					const feeSchedule = (physicians as any && (physicians as any).__feeSchedule) ? (physicians as any).__feeSchedule : undefined;
					const periods = (physicians as any && (physicians as any).__periods) ? (physicians as any).__periods : undefined;
					const batches = (physicians as any && (physicians as any).__batches) ? (physicians as any).__batches : undefined;
					const insurances = (physicians as any && (physicians as any).__insurances) ? (physicians as any).__insurances : undefined;
					return res.json({ ok: true, rooms, appointmentTypes, physicians, feeSchedule, periods, batches, insurances, generalLedgerAccounts, caseFlagColors, logs });
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

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {});

export default app;
