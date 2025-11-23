import { ApiLogEntry } from './utils/api';

export type SeederOptions = {
    apiUrl?: string;
    username?: string;
    password?: string;
    facilityId?: number;
    mode?: string;
    count?: number;
    suffix?: string;
    runDemoCalls?: boolean;
    demoUrl?: string;
};

// Wire-only stub: exported entry point that seeding systems can call.
// The real implementation should perform the seeding steps and use the
// provided logFn to record ApiLogEntry objects for each outgoing request.
export async function runSeeder(_opts: SeederOptions = {}, _token?: string, _logFn?: (entry: ApiLogEntry) => void) {
    // Intentionally minimal: do not perform network actions here.
    if (_logFn) {
        try {
            _logFn({ url: 'local:seeder', method: 'SEED', status: 'wired', durationMs: 0, timestamp: new Date().toISOString() });
        } catch (e) {}
    }
    return { ok: true, message: 'seeder wired (no-op)' };
}

export default runSeeder;
