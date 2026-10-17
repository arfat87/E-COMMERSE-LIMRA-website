/**
 * LIMRA RESTAURANT — DEPLOYMENT & OPERATIONAL RELIABILITY TEST SUITE
 * 
 * Verifies:
 * 1. Startup Configuration Validator & Secret Redaction (No leaked tokens)
 * 2. Backend Route Parity (Vercel Serverless vs Node.js Native HTTP)
 * 3. CORS, Security Headers, and Dynamic Origin Reflection
 * 4. Database Migration Sequencing, Chronology, and Idempotency
 * 5. Production Multi-Platform Build Artifact Integrity (Web, Electron, Capacitor)
 * 6. Health Check Endpoint (/api/db-status) Contract & Structural Conformance
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStartupConfig } from "../api/lib/env-validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../");

console.log("\n🚀 =========================================================");
console.log("   LIMRA RESTAURANT — DEPLOYMENT & RELIABILITY TEST SUITE");
console.log("=========================================================\n");

let passedCount = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    process.exit(1);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// SUITE 1: ENVIRONMENT & SECRET CONFIGURATION VALIDATOR
// -----------------------------------------------------------------------------
test("1.1 validateStartupConfig returns structured diagnostics without throwing", () => {
  const result = validateStartupConfig();
  assert.ok(result, "Expected validation result object");
  assert.ok(Array.isArray(result.diagnostics), "Expected diagnostics array");
  assert.ok(Array.isArray(result.errors), "Expected errors array");
  assert.ok(Array.isArray(result.warnings), "Expected warnings array");
});

test("1.2 Secret values are never printed or leaked in diagnostic notes", () => {
  const result = validateStartupConfig();
  const rawEnvString = Object.values(process.env).join(" ");

  for (const diag of result.diagnostics) {
    assert.ok(!diag.notes.includes("eyJh"), "Diagnostic notes must not expose JWT tokens");
    assert.ok(!diag.notes.includes("rzp_live_"), "Diagnostic notes must not expose live API keys");
    assert.ok(!diag.notes.includes("secret"), "Diagnostic notes must not leak raw secrets");
    assert.ok(["CONFIGURED", "CONFIGURED (WARNING)", "MISSING (REQUIRED)", "UNCONFIGURED (OPTIONAL)"].includes(diag.status));
  }
});

test("1.3 Production validator requires Supabase URL and Anon Key", () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origUrl = process.env.SUPABASE_URL;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.SUPABASE_URL;
    const res = validateStartupConfig();
    assert.strictEqual(res.valid, false, "Expected validation failure when SUPABASE_URL is missing in production");
    assert.ok(res.errors.some(e => e.includes("SUPABASE_URL")), "Expected error for SUPABASE_URL");
  } finally {
    process.env.NODE_ENV = origNodeEnv;
    if (origUrl) process.env.SUPABASE_URL = origUrl;
  }
});

// -----------------------------------------------------------------------------
// SUITE 2: BACKEND ROUTE PARITY (VERCEL SERVERLESS VS NATIVE NODE.JS)
// -----------------------------------------------------------------------------
const EXPECTED_ROUTES = [
  "orders.js",
  "create-order.js",
  "verify-payment.js",
  "analytics.js",
  "auth.js",
  "db.js",
  "menu.js",
  "db-status.js",
  "webhook.js"
];

for (const routeFile of EXPECTED_ROUTES) {
  await asyncTest(`2. Route ${routeFile} exports valid serverless handler function`, async () => {
    const routePath = path.join(ROOT_DIR, "backend/api", routeFile);
    assert.ok(fs.existsSync(routePath), `Route file must exist: ${routeFile}`);

    const module = await import(`file://${routePath.replace(/\\/g, "/")}`);
    assert.strictEqual(typeof module.default, "function", `Route ${routeFile} must export default async handler function`);
  });
}

for (const routeFile of EXPECTED_ROUTES) {
  test(`2. Delegate wrapper api/${routeFile} re-exports backend handler`, () => {
    const wrapperPath = path.join(ROOT_DIR, "api", routeFile);
    assert.ok(fs.existsSync(wrapperPath), `Vercel wrapper must exist: api/${routeFile}`);
    const content = fs.readFileSync(wrapperPath, "utf-8");
    assert.ok(
      content.includes(`../backend/api/${routeFile}`) || content.includes(`backend/api/${routeFile}`),
      `Wrapper api/${routeFile} must import corresponding backend module`
    );
  });
}

// -----------------------------------------------------------------------------
// SUITE 3: CORS AND SECURITY HEADERS CONFORMANCE
// -----------------------------------------------------------------------------
test("3.1 Server CORS headers allow credentialed cross-origin access and custom headers", () => {
  const serverPath = path.join(ROOT_DIR, "backend/server.js");
  const serverCode = fs.readFileSync(serverPath, "utf-8");

  assert.ok(serverCode.includes("Access-Control-Allow-Origin"), "Must set Access-Control-Allow-Origin");
  assert.ok(serverCode.includes("Access-Control-Allow-Credentials"), "Must allow credentials");
  assert.ok(serverCode.includes("X-Idempotency-Key"), "Must allow X-Idempotency-Key in allowed headers");
  assert.ok(serverCode.includes("X-Content-Type-Options"), "Must set X-Content-Type-Options: nosniff");
  assert.ok(serverCode.includes("X-Frame-Options"), "Must set X-Frame-Options: SAMEORIGIN");
});

test("3.2 Vercel configuration routes API paths cleanly and defines static output directory", () => {
  const vercelConfigPath = path.join(ROOT_DIR, "vercel.json");
  assert.ok(fs.existsSync(vercelConfigPath), "vercel.json must exist in root");

  const vercelJson = JSON.parse(fs.readFileSync(vercelConfigPath, "utf-8"));
  assert.strictEqual(vercelJson.outputDirectory, "dist", "Vercel outputDirectory must be dist");
  assert.ok(Array.isArray(vercelJson.rewrites), "Vercel rewrites must be configured");
  assert.ok(
    vercelJson.rewrites.some(r => r.source === "/api/:path*"),
    "Vercel rewrites must preserve /api/:path*"
  );
});

// -----------------------------------------------------------------------------
// SUITE 4: DATABASE MIGRATIONS INTEGRITY & CHRONOLOGY
// -----------------------------------------------------------------------------
test("4.1 All database migrations follow strict timestamp format and chronological order", () => {
  const migrationsDir = path.join(ROOT_DIR, "database/migrations");
  assert.ok(fs.existsSync(migrationsDir), "database/migrations directory must exist");

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql"));
  assert.ok(files.length >= 32, `Expected at least 32 migrations, found ${files.length}`);

  const timestampRegex = /^(\d{14})_(.+)\.sql$/;
  let previousTimestamp = "0";

  for (const file of files) {
    const match = file.match(timestampRegex);
    assert.ok(match, `Migration file ${file} does not match YYYYMMDDHHMMSS_name.sql pattern`);

    const timestamp = match[1];
    assert.ok(
      timestamp >= previousTimestamp,
      `Migration ${file} (${timestamp}) is out of order compared to previous (${previousTimestamp})`
    );
    previousTimestamp = timestamp;

    const fullPath = path.join(migrationsDir, file);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 0, `Migration file ${file} must not be empty`);
  }
});

test("4.2 Migrations are idempotent and contain safe conditional DDL statements", () => {
  const migrationsDir = path.join(ROOT_DIR, "database/migrations");
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql"));

  for (const file of files) {
    const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    // Ensure dangerous unqualified DROP TABLE does not exist without IF EXISTS
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim().toUpperCase();
      if (trimmed.startsWith("DROP TABLE ") && !trimmed.startsWith("DROP TABLE IF EXISTS")) {
        assert.fail(`Non-idempotent DROP TABLE without IF EXISTS detected in ${file}: ${line}`);
      }
    }
  }
});

// -----------------------------------------------------------------------------
// SUITE 5: PRODUCTION BUILD ARTIFACTS VERIFICATION
// -----------------------------------------------------------------------------
test("5.1 Web distribution directory contains compiled HTML documents and assets", () => {
  const distDir = path.join(ROOT_DIR, "dist");
  assert.ok(fs.existsSync(distDir), "dist directory must exist");

  assert.ok(fs.existsSync(path.join(distDir, "index.html")), "dist/index.html must exist");
  assert.ok(fs.existsSync(path.join(distDir, "admin.html")), "dist/admin.html must exist");
  assert.ok(fs.existsSync(path.join(distDir, "table/index.html")), "dist/table/index.html must exist");
  assert.ok(fs.existsSync(path.join(distDir, "manifest.json")), "dist/manifest.json must exist for PWA");
  assert.ok(fs.existsSync(path.join(distDir, "sw.js")), "dist/sw.js must exist for Service Worker");

  const indexContent = fs.readFileSync(path.join(distDir, "index.html"), "utf-8");
  assert.ok(indexContent.includes("<div id=\"root\">") || indexContent.includes("<body"), "Valid HTML document structure");
});

test("5.2 Electron desktop POS configuration and executable package", () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8"));
  assert.strictEqual(pkgJson.main, "electron/main.cjs", "Electron main entry point must be electron/main.cjs");
  assert.ok(pkgJson.build, "electron-builder configuration must exist");
  assert.strictEqual(pkgJson.build.appId, "com.limra.pos");
  assert.ok(pkgJson.build.files.includes("dist/**/*"), "Electron package must bundle dist files");

  const electronMain = fs.readFileSync(path.join(ROOT_DIR, "electron/main.cjs"), "utf-8");
  assert.ok(electronMain.includes("http.createServer"), "Electron must include local HTTP loopback server");
  assert.ok(electronMain.includes("persist:limra-pos-data"), "Electron must use persistent partition");

  const winUnpackedExe = path.join(ROOT_DIR, "release/win-unpacked/Limra Restaurant POS.exe");
  assert.ok(fs.existsSync(winUnpackedExe), "Windows Electron executable must exist in release/win-unpacked/");
});

test("5.3 Capacitor Android configuration and APK output", () => {
  const capConfigPath = path.join(ROOT_DIR, "capacitor.config.json");
  assert.ok(fs.existsSync(capConfigPath), "capacitor.config.json must exist");

  const capConfig = JSON.parse(fs.readFileSync(capConfigPath, "utf-8"));
  assert.strictEqual(capConfig.webDir, "dist", "Capacitor webDir must be dist");
  assert.strictEqual(capConfig.appId, "com.limra.pos");

  const apkPath = path.join(ROOT_DIR, "android/app/build/outputs/apk/debug/app-debug.apk");
  assert.ok(fs.existsSync(apkPath), "Android debug APK must be compiled in android/app/build/outputs/apk/debug/");
  const stat = fs.statSync(apkPath);
  assert.ok(stat.size > 10_000_000, `APK size must be at least 10MB (actual: ${(stat.size / 1_000_000).toFixed(2)} MB)`);
});

// -----------------------------------------------------------------------------
// SUITE 6: HEALTH CHECK & SYSTEM CONTRACT
// -----------------------------------------------------------------------------
await asyncTest("6.1 Health check handler /api/db-status returns complete system status", async () => {
  const { default: handler } = await import("../api/db-status.js");

  let statusCode = 200;
  let responseData = null;

  const mockReq = { method: "GET" };
  const mockRes = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    }
  };

  await handler(mockReq, mockRes);

  assert.strictEqual(statusCode, 200, "Healthcheck must return HTTP 200");
  assert.ok(responseData, "Response data must not be null");
  assert.ok(responseData.status, "Healthcheck must include status");
  assert.ok(responseData.database, "Healthcheck must report database name");
  assert.ok(responseData.serverTime, "Healthcheck must include ISO serverTime");
  assert.ok(typeof responseData.tables === "object", "Healthcheck must include tables map");
});

console.log("\n=========================================================");
console.log(`RESULTS: ${passedCount} Passed, 0 Failed`);
console.log("=========================================================\n");
