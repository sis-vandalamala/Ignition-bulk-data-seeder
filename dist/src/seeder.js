"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSeeder = runSeeder;
// Wire-only stub: exported entry point that seeding systems can call.
// The real implementation should perform the seeding steps and use the
// provided logFn to record ApiLogEntry objects for each outgoing request.
async function runSeeder(_opts = {}, _token, _logFn) {
    // Intentionally minimal: do not perform network actions here.
    if (_logFn) {
        try {
            _logFn({ url: 'local:seeder', method: 'SEED', status: 'wired', durationMs: 0, timestamp: new Date().toISOString() });
        }
        catch (e) { }
    }
    return { ok: true, message: 'seeder wired (no-op)' };
}
exports.default = runSeeder;
