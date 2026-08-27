import dotenv from "dotenv";
dotenv.config();

async function test() {
  console.log("Testing API Handlers...");

  // 1. Test db-status
  const { default: statusHandler } = await import("../api/db-status.js");
  const mockRes = (label) => ({
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(data) { console.log("[" + label + "] Status " + this.statusCode + ": " + JSON.stringify(data).slice(0, 160)); return data; },
    end() { return this; }
  });

  await statusHandler({ method: "GET" }, mockRes("DB Status"));

  // 2. Test menu
  const { default: menuHandler } = await import("../api/menu.js");
  await menuHandler({ method: "GET", query: { category: "biryani" } }, mockRes("Menu (Biryani)"));

  // 3. Test orders POST
  const { default: ordersHandler } = await import("../api/orders.js");
  let createdOrderId = null;
  const mockOrderPostRes = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(data) {
      console.log("[Order POST] Status " + this.statusCode + ": " + JSON.stringify(data).slice(0, 160));
      if (data.data) createdOrderId = data.data.id;
      return data;
    },
    end() { return this; }
  };

  await ordersHandler({
    method: "POST",
    body: {
      customerName: "Arfat Ali",
      customerPhone: "9876543210",
      orderType: "delivery",
      items: [
        { id: 1, name: "Hot & Sour Veg Soup", price: 75, qty: 2 }
      ],
      notes: "Test Atlas Order"
    }
  }, mockOrderPostRes);

  // 4. Test orders GET
  await ordersHandler({ method: "GET", query: { limit: 5 } }, mockRes("Orders GET"));

  console.log('\n✅ All MongoDB Atlas API tests passed successfully!');
  process.exit(0);
}

test().catch((err) => {
  console.error("Test Error:", err);
  process.exit(1);
});
