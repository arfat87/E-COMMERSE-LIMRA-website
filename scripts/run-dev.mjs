import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

console.log("\x1b[36m%s\x1b[0m", "==================================================");
console.log("\x1b[32m%s\x1b[0m", "🚀 STARTING LIMRA RESTAURANT (FRONTEND + BACKEND)");
console.log("\x1b[36m%s\x1b[0m", "==================================================");
console.log("\x1b[33m%s\x1b[0m", "📍 Quick Access Links (Local Dev):");
console.log("\x1b[32m%s\x1b[0m", "   • Customer Storefront:     http://localhost:5173/");
console.log("\x1b[35m%s\x1b[0m", "   • Admin & POS Hub (Ph. 2): http://localhost:5173/admin.html");
console.log("\x1b[36m%s\x1b[0m", "   • Stock Manager (Phase 2): http://localhost:5173/stock-manager/index.html");
console.log("\x1b[34m%s\x1b[0m", "   • Dine-In Table 1 QR:      http://localhost:5173/table/index.html?table=1");
console.log("\x1b[36m%s\x1b[0m", "==================================================\n");

// 1. Launch Backend Server
const backendProcess = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "start", "--prefix", "backend"],
  {
    cwd: ROOT_DIR,
    stdio: "inherit",
    shell: true
  }
);

// 2. Launch Frontend Dev Server
const frontendProcess = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "dev", "--prefix", "frontend"],
  {
    cwd: ROOT_DIR,
    stdio: "inherit",
    shell: true
  }
);

function cleanup() {
  console.log("\n\x1b[33m%s\x1b[0m", "Shutting down frontend and backend processes...");
  try {
    backendProcess.kill();
  } catch (e) {}
  try {
    frontendProcess.kill();
  } catch (e) {}
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);
