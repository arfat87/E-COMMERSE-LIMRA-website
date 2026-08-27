import { queryInsforge } from "./lib/insforge.js";

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
    // 1. Overall Revenue & Order Metrics
    const totalOrdersRes = await queryInsforge("SELECT COUNT(*) as count FROM public.orders;");
    const totalOrders = Number(totalOrdersRes[0]?.count || 0);

    const completedRes = await queryInsforge("SELECT COUNT(*) as count FROM public.orders WHERE status IN ('delivered', 'confirmed');");
    const completedOrders = Number(completedRes[0]?.count || 0);

    const pendingRes = await queryInsforge("SELECT COUNT(*) as count FROM public.orders WHERE status IN ('pending', 'preparing', 'ready', 'hold');");
    const pendingOrders = Number(pendingRes[0]?.count || 0);

    const cancelledRes = await queryInsforge("SELECT COUNT(*) as count FROM public.orders WHERE status = 'cancelled';");
    const cancelledOrders = Number(cancelledRes[0]?.count || 0);

    const revRes = await queryInsforge("SELECT COALESCE(SUM(total_amount), 0) as gross_revenue, COALESCE(AVG(total_amount), 0) as avg_order_value FROM public.orders WHERE status != 'cancelled';");
    const grossRevenue = Math.round(Number(revRes[0]?.gross_revenue || 0) * 100) / 100;
    const avgOrderValue = Math.round(Number(revRes[0]?.avg_order_value || 0) * 100) / 100;

    // 2. Order Type Breakdown
    const orderTypeRes = await queryInsforge(`
      SELECT COALESCE(order_type, 'dine_in') as _id, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue 
      FROM public.orders 
      GROUP BY order_type 
      ORDER BY count DESC;
    `);

    // 3. Payment Status Breakdown
    const paymentRes = await queryInsforge(`
      SELECT COALESCE(payment_status, 'unpaid') as _id, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue 
      FROM public.orders 
      GROUP BY payment_status 
      ORDER BY count DESC;
    `);

    // 4. Hourly Distribution Heatmap
    let hourlyHeatmap = [];
    try {
      hourlyHeatmap = await queryInsforge(`
        SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata') as _id, COUNT(*) as orderCount, COALESCE(SUM(total_amount), 0) as revenue
        FROM public.orders
        GROUP BY _id
        ORDER BY _id ASC;
      `);
    } catch (e) {}

    // 5. Top 10 Best Selling Menu Items
    const topDishes = await queryInsforge(`
      SELECT item_name as _id, COALESCE(SUM(quantity), 0) as totalQuantity, COALESCE(SUM(line_total), 0) as totalRevenue
      FROM public.order_items
      GROUP BY item_name
      ORDER BY totalQuantity DESC
      LIMIT 10;
    `);

    // 6. Inventory Low Stock Alerts
    const lowStockAlerts = await queryInsforge(`
      SELECT id, name, category, qty as current_stock, min_qty as min_threshold, unit
      FROM public.stock_items
      WHERE qty <= min_qty
      ORDER BY qty ASC
      LIMIT 20;
    `);

    const totalStockRes = await queryInsforge("SELECT COUNT(*) as count FROM public.stock_items;");
    const totalTrackedItems = Number(totalStockRes[0]?.count || 0);

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
        orderTypeBreakdown: orderTypeRes,
        paymentBreakdown: paymentRes,
        hourlyHeatmap,
        topDishes,
        inventory: {
          totalTrackedItems,
          lowStockCount: lowStockAlerts.length,
          lowStockAlerts
        }
      }
    });
  } catch (error) {
    console.error("[InsForge Analytics Error]:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to generate analytics"
    });
  }
}
