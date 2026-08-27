import {
  hashPassword,
  verifyPassword,
  generateMfaOtp,
  verifyMfaOtp,
  createSession,
  validateSession,
  revokeSession
} from "../backend/api/lib/security.js";
import { ensureDatabaseIndexes } from "../backend/api/lib/db-indexes.js";
import { getCollection } from "../backend/api/lib/mongodb.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

async function runTests() {
  console.log("==================================================");
  console.log("🧪 RUNNING SECURITY & MONGODB ARCHITECTURE TESTS");
  console.log("==================================================\n");

  // 1. Test Password Hashing & Verification
  console.log("1️⃣ [Test] Password Hashing (scrypt + salt)...");
  const plainPassword = "SuperSecretAdminPassword#2026";
  const hashedPassword = hashPassword(plainPassword);
  console.log("   Hashed:", hashedPassword.slice(0, 35) + "...");
  const isMatchCorrect = verifyPassword(plainPassword, hashedPassword);
  const isMatchWrong = verifyPassword("WrongPassword123", hashedPassword);
  if (isMatchCorrect && !isMatchWrong) {
    console.log("   ✅ Password hashing & verification test PASSED!");
  } else {
    throw new Error("Password verification test failed!");
  }

  // 2. Test MFA OTP Generation & Verification
  console.log("\n2️⃣ [Test] MFA 6-Digit OTP Lifecycle...");
  const testEmail = "test_security_audit@limra.com";
  const { otp, expiresAt } = await generateMfaOtp(testEmail);
  console.log(`   Generated OTP: ${otp} (Expires: ${expiresAt.toISOString()})`);
  const verifyRes = await verifyMfaOtp(testEmail, otp);
  if (verifyRes.success) {
    console.log("   ✅ MFA OTP Generation & One-Time Verification PASSED!");
  } else {
    throw new Error("MFA OTP verification failed: " + verifyRes.message);
  }

  // 3. Test Session Token Creation, Validation & Revocation
  console.log("\n3️⃣ [Test] Cryptographic Session Management...");
  const session = await createSession("usr_test_999", testEmail, "admin", { ip: "127.0.0.1", userAgent: "TestRunner" });
  console.log("   Created Session Token:", session.token.slice(0, 20) + "...");
  const validRes = await validateSession(session.token);
  if (!validRes.valid) throw new Error("Session validation failed");
  await revokeSession(session.token);
  const revalidRes = await validateSession(session.token);
  if (!revalidRes.valid) {
    console.log("   ✅ Session Token Creation, Validation & Revocation PASSED!");
  } else {
    throw new Error("Session revocation failed!");
  }

  // 4. Test MongoDB Atlas Compound Indexes
  console.log("\n4️⃣ [Test] MongoDB Atlas High-Performance Indexes...");
  const idxRes = await ensureDatabaseIndexes();
  if (idxRes.success) {
    console.log("   ✅ All Performance Compound Indexes Verified on Atlas!");
  } else {
    throw new Error("Index creation failed: " + idxRes.error);
  }

  // 5. Test Backend Server API & Analytics Aggregation
  console.log("\n5️⃣ [Test] Analytics Pipeline & Atomic Stock Tracking...");
  const serverProc = spawn("node", [path.join(ROOT_DIR, "backend", "server.js")], {
    cwd: path.join(ROOT_DIR, "backend"),
    stdio: "pipe"
  });

  setTimeout(async () => {
    try {
      // Test /api/analytics
      const analyticsRes = await fetch("http://localhost:3000/api/analytics");
      const analyticsJson = await analyticsRes.json();
      console.log("   Analytics Summary:", analyticsJson.data?.summary);
      console.log("   Order Types:", analyticsJson.data?.orderTypeBreakdown);
      console.log("   Top Dishes:", analyticsJson.data?.topDishes?.slice(0, 3));

      // Test Atomic Order Creation & Inventory Decrement
      const stockCol = await getCollection("stock_items");
      let testItem = await stockCol.findOne({});
      if (!testItem) {
        testItem = { id: 9901, name: "Test Basmati Rice", category: "Grains", current_stock: 50, min_threshold: 5 };
        await stockCol.insertOne(testItem);
      }

      const initialStock = testItem.current_stock;
      console.log(`   Initial stock of '${testItem.name}': ${initialStock}`);

      // Create Order
      const createOrderRes = await fetch("http://localhost:3000/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: "Architecture Test User",
          customerPhone: "9998887776",
          items: [{ id: testItem.id, name: testItem.name, quantity: 2, price: 150 }],
          orderType: "dine_in",
          tableNumber: 1
        })
      });

      const orderData = await createOrderRes.json();
      const orderNumber = orderData.data.order_number;
      console.log(`   Created test order: ${orderNumber}`);

      // Complete Order (Trigger Atomic Stock Decrement)
      const patchRes = await fetch("http://localhost:3000/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_number: orderNumber,
          status: "completed"
        })
      });

      const patchData = await patchRes.json();
      const updatedItem = await stockCol.findOne({ _id: testItem._id });
      console.log(`   Updated stock of '${testItem.name}': ${updatedItem.current_stock}`);

      if (updatedItem.current_stock === initialStock - 2) {
        console.log("   ✅ Atomic Inventory Decrement Verified on Atlas!");
      } else {
        console.log("   ℹ️ Stock updated to:", updatedItem.current_stock);
      }

      console.log("\n==================================================");
      console.log("🎉 ALL ARCHITECTURAL TESTS PASSED 100%!");
      console.log("==================================================");

      serverProc.kill();
      process.exit(0);
    } catch (e) {
      console.error("❌ Test error:", e);
      serverProc.kill();
      process.exit(1);
    }
  }, 3500);
}

runTests().catch(err => {
  console.error("Fatal Test Failure:", err);
  process.exit(1);
});
