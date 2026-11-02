/**
 * LIMRA RESTAURANT — TEST ENVIRONMENT GUARD (TEST RUNNER ENTRYPOINT)
 * 
 * Re-exports the core test protection layer from backend/api/lib/test-guard.js
 * and ensures automatic test execution safety check upon import.
 */

export * from "../api/lib/test-guard.js";
import { assertTestEnvironment } from "../api/lib/test-guard.js";

// Automatically run safety check when imported by any test suite
assertTestEnvironment({ runnerName: process.argv[1] || "Automated Test Suite" });
