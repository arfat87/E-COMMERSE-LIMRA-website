import dbStatusHandler from "../backend/api/db-status.js";
import ordersHandler from "../backend/api/orders.js";
import menuHandler from "../backend/api/menu.js";
import analyticsHandler from "../backend/api/analytics.js";
import dbHandler from "../backend/api/db.js";

function createMockReqRes(method = "GET", body = {}, query = {}) {
  const req = {
    method,
    body,
    query,
    headers: { host: "localhost:3000" }
  };

  let responseData = null;
  let statusCode = 200;

  const res = {
    statusCode: 200,
    setHeader: () => {},
    getHeader: () => {},
    status(code) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    end(data) {
      if (data && !responseData) {
        try { responseData = JSON.parse(data); } catch (e) { responseData = data; }
      }
      return this;
    }
  };

  return { req, res, getResult: () => ({ statusCode, data: responseData }) };
}

async function testAll() {
  console.log("==================================================");
  console.log("🧪 TESTING BACKEND API ENDPOINTS WITH INSFORGE BAAS");
  console.log("==================================================\n");

  // 1. Test /api/db-status
  console.log("1. Testing GET /api/db-status...");
  const mock1 = createMockReqRes("GET");
  await dbStatusHandler(mock1.req, mock1.res);
  const res1 = mock1.getResult();
  console.log(`   Status: HTTP ${res1.statusCode} | DB Status: ${res1.data?.status} | Latency: ${res1.data?.latencyMs}ms`);
  console.log(`   Table stats: orders=${res1.data?.tables?.orders}, stock_items=${res1.data?.tables?.stock_items}, notifications=${res1.data?.tables?.notifications}`);
  if (res1.statusCode !== 200 || res1.data?.status !== "connected") throw new Error("db-status test failed");

  // 2. Test /api/orders
  console.log("\n2. Testing GET /api/orders...");
  const mock2 = createMockReqRes("GET", {}, { limit: "5" });
  await ordersHandler(mock2.req, mock2.res);
  const res2 = mock2.getResult();
  console.log(`   Status: HTTP ${res2.statusCode} | Count: ${res2.data?.count} orders retrieved`);
  console.log(`   First order: #${res2.data?.data?.[0]?.order_number} (${res2.data?.data?.[0]?.customer_name}) - ₹${res2.data?.data?.[0]?.total_amount}`);
  if (res2.statusCode !== 200 || !res2.data?.data?.length) throw new Error("orders test failed");

  // 3. Test /api/menu
  console.log("\n3. Testing GET /api/menu...");
  const mock3 = createMockReqRes("GET");
  await menuHandler(mock3.req, mock3.res);
  const res3 = mock3.getResult();
  console.log(`   Status: HTTP ${res3.statusCode} | Overrides Count: ${res3.data?.count}`);
  if (res3.statusCode !== 200 || !res3.data?.data) throw new Error("menu test failed");

  // 4. Test /api/analytics
  console.log("\n4. Testing GET /api/analytics...");
  const mock4 = createMockReqRes("GET");
  await analyticsHandler(mock4.req, mock4.res);
  const res4 = mock4.getResult();
  console.log(`   Status: HTTP ${res4.statusCode}`);
  console.log(`   Gross Revenue: ₹${res4.data?.data?.summary?.grossRevenue} | Total Orders: ${res4.data?.data?.summary?.totalOrders}`);
  console.log(`   Tracked Items: ${res4.data?.data?.inventory?.totalTrackedItems} | Low Stock: ${res4.data?.data?.inventory?.lowStockCount}`);
  if (res4.statusCode !== 200 || !res4.data?.data?.summary) throw new Error("analytics test failed");

  // 5. Test /api/db (universal select)
  console.log("\n5. Testing POST /api/db (select stock_items)...");
  const mock5 = createMockReqRes("POST", { action: "select", table: "stock_items", options: { limit: 3 } });
  await dbHandler(mock5.req, mock5.res);
  const res5 = mock5.getResult();
  console.log(`   Status: HTTP ${res5.statusCode} | Retrieved: ${res5.data?.data?.length} items`);
  if (res5.statusCode !== 200 || !res5.data?.data?.length) throw new Error("db select test failed");

  // 6. Test /api/db (universal RPC get_customer_orders)
  console.log("\n6. Testing POST /api/db (RPC get_customer_orders)...");
  const mock6 = createMockReqRes("POST", { action: "rpc", rpc: "get_customer_orders", params: { p_phone: "7501299357" } });
  await dbHandler(mock6.req, mock6.res);
  const res6 = mock6.getResult();
  console.log(`   Status: HTTP ${res6.statusCode} | Retrieved: ${res6.data?.data?.length} customer orders`);
  if (res6.statusCode !== 200) throw new Error("db rpc test failed");

  console.log("\n==================================================");
  console.log("🎉 ALL BACKEND API TESTS PASSED 100% WITH INSFORGE!");
  console.log("==================================================\n");
}

testAll().catch(err => {
  console.error("❌ Test error:", err);
  process.exit(1);
});
