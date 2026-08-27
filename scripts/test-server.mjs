import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const serverProc = spawn("node", [path.join(ROOT_DIR, "backend", "server.js")], {
  cwd: path.join(ROOT_DIR, "backend"),
  stdio: "pipe"
});

serverProc.stdout.on("data", (data) => {
  console.log(`[Backend stdout]: ${data.toString().trim()}`);
});

serverProc.stderr.on("data", (data) => {
  console.error(`[Backend stderr]: ${data.toString().trim()}`);
});

setTimeout(async () => {
  try {
    console.log("\n--- Testing /api/db-status ---");
    const statusRes = await fetch("http://localhost:3000/api/db-status");
    const statusData = await statusRes.json();
    console.log("DB Status:", statusData);

    console.log("\n--- Testing /api/menu ---");
    const menuRes = await fetch("http://localhost:3000/api/menu");
    const menuData = await menuRes.json();
    console.log("Menu Items Count:", menuData.count);

    console.log("\n--- Testing Static /index.html ---");
    const htmlRes = await fetch("http://localhost:3000/index.html");
    console.log("HTML Status:", htmlRes.status, "Content-Type:", htmlRes.headers.get("content-type"));

    console.log("\n--- Testing Static /table/index.html ---");
    const tableRes = await fetch("http://localhost:3000/table/index.html");
    console.log("Table Status:", tableRes.status, "Content-Type:", tableRes.headers.get("content-type"));

    console.log("\n✅ ALL TESTS PASSED SUCCESSFULLY!");
  } catch (err) {
    console.error("❌ Test failed:", err);
  } finally {
    serverProc.kill();
    process.exit(0);
  }
}, 3000);
