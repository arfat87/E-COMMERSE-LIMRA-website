import { supabase } from "./lib/supabase.js";

export default async function handler(req, res) {
  if (res.setHeader) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
    );
  }

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 1. Fetch Orders for analytics
    const { data: allOrders, error: ordErr } = await supabase
      .from("orders")
      .select("id, total_amount, status, payment_status, order_type, created_at")
      .limit(5000);

    if (ordErr) throw ordErr;

    const orders = allOrders || [];
    const totalOrders = orders.length;

    let completedOrders = 0;
    let pendingOrders = 0;
    let cancelledOrders = 0;
    let grossRevenue = 0;

    const orderTypeMap = {};
    const paymentMap = {};
    const hourlyMap = {};

    for (const o of orders) {
      const amt = Number(o.total_amount) || 0;
      const status = (o.status || "pending").toLowerCase();
      const type = o.order_type || "delivery";
      const payStatus = o.payment_status || "unpaid";

      if (status === "delivered" || status === "confirmed") {
        completedOrders++;
      } else if (status === "cancelled") {
        cancelledOrders++;
      } else {
        pendingOrders++;
      }

      if (status !== "cancelled") {
        grossRevenue += amt;

        orderTypeMap[type] = orderTypeMap[type] || { _id: type, count: 0, revenue: 0 };
        orderTypeMap[type].count++;
        orderTypeMap[type].revenue += amt;

        paymentMap[payStatus] = paymentMap[payStatus] || { _id: payStatus, count: 0, revenue: 0 };
        paymentMap[payStatus].count++;
        paymentMap[payStatus].revenue += amt;

        if (o.created_at) {
          const hour = new Date(o.created_at).getHours();
          hourlyMap[hour] = hourlyMap[hour] || { _id: hour, orderCount: 0, revenue: 0 };
          hourlyMap[hour].orderCount++;
          hourlyMap[hour].revenue += amt;
        }
      }
    }

    const nonCancelledCount = totalOrders - cancelledOrders;
    const avgOrderValue = nonCancelledCount > 0 ? Math.round((grossRevenue / nonCancelledCount) * 100) / 100 : 0;
    grossRevenue = Math.round(grossRevenue * 100) / 100;

    const orderTypeBreakdown = Object.values(orderTypeMap).sort((a, b) => b.count - a.count);
    const paymentBreakdown = Object.values(paymentMap).sort((a, b) => b.count - a.count);
    const hourlyHeatmap = Object.values(hourlyMap).sort((a, b) => a._id - b._id);

    // 2. Fetch Top Dishes
    const { data: orderItems } = await supabase
      .from("order_items")
      .select("item_name, quantity, line_total")
      .limit(5000);

    const dishMap = {};
    for (const it of orderItems || []) {
      const name = it.item_name || "Item";
      dishMap[name] = dishMap[name] || { _id: name, totalQuantity: 0, totalRevenue: 0 };
      dishMap[name].totalQuantity += Number(it.quantity) || 1;
      dishMap[name].totalRevenue += Number(it.line_total) || 0;
    }
    const topDishes = Object.values(dishMap)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 10);

    // 3. Inventory Low Stock Alerts
    const { data: stockItems } = await supabase
      .from("stock_items")
      .select("id, name, category, qty, min_qty, unit");

    const allStock = stockItems || [];
    const lowStockAlerts = allStock
      .filter((s) => (Number(s.qty) || 0) <= (Number(s.min_qty) || 5))
      .map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        current_stock: s.qty,
        min_threshold: s.min_qty,
        unit: s.unit
      }))
      .slice(0, 20);

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          totalOrders,
          completedOrders,
          pendingOrders,
          cancelledOrders,
          grossRevenue,
          avgOrderValue
        },
        orderTypeBreakdown,
        paymentBreakdown,
        hourlyHeatmap,
        topDishes,
        inventory: {
          totalTrackedItems: allStock.length,
          lowStockCount: lowStockAlerts.length,
          lowStockAlerts
        }
      }
    });
  } catch (error) {
    console.error("[Supabase Analytics Error]:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to generate analytics"
    });
  }
}
