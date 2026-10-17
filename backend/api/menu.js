import { supabase } from "./lib/supabase.js";
import { requireRole } from "./lib/auth-middleware.js";

export default async function handler(req, res) {
  try {
    // 1. GET: Public Menu Retrieval (Accessible to all guests and customers)
    if (req.method === "GET") {
      const { data: overrides, error } = await supabase
        .from("menu_overrides")
        .select("*")
        .order("id", { ascending: true });

      if (error) throw error;

      return res.status(200).json({
        success: true,
        count: overrides ? overrides.length : 0,
        data: overrides || []
      });
    }

    // 2. POST / UPSERT Menu Item Override (Manager or Owner Only)
    if (req.method === "POST") {
      const auth = await requireRole(req, res, ["owner", "manager", "admin"]);
      if (!auth) return; // Response sent by requireRole

      const { id, price, mrp, available = true, featured = false, description = "" } = req.body || {};

      if (!id || price === undefined) {
        return res.status(400).json({ success: false, error: "Item id and price are required." });
      }

      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice < 0) {
        return res.status(400).json({ success: false, error: "Price must be a valid non-negative number." });
      }

      const payload = {
        id: Number(id),
        price: numPrice,
        mrp: mrp ? Math.max(0, Number(mrp)) : null,
        available: available !== false,
        featured: featured === true,
        description: String(description || "").slice(0, 500),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from("menu_overrides")
        .upsert(payload)
        .select();

      if (error) throw error;

      return res.status(200).json({
        success: true,
        data: data ? data[0] : payload
      });
    }

    // 3. PATCH: Toggle availability or update stock/price (Manager or Owner Only)
    if (req.method === "PATCH") {
      const auth = await requireRole(req, res, ["owner", "manager", "admin"]);
      if (!auth) return; // Response sent by requireRole

      const { id, available, price, mrp, featured, description } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, error: "Item id is required." });
      }

      const updatePayload = { updated_at: new Date().toISOString() };
      if (available !== undefined) updatePayload.available = available === true;
      if (price !== undefined) {
        const numPrice = Number(price);
        if (isNaN(numPrice) || numPrice < 0) {
          return res.status(400).json({ success: false, error: "Price must be a valid non-negative number." });
        }
        updatePayload.price = numPrice;
      }
      if (mrp !== undefined) updatePayload.mrp = mrp ? Math.max(0, Number(mrp)) : null;
      if (featured !== undefined) updatePayload.featured = featured === true;
      if (description !== undefined) updatePayload.description = String(description).slice(0, 500);

      const { data, error } = await supabase
        .from("menu_overrides")
        .update(updatePayload)
        .eq("id", Number(id))
        .select();

      if (error || !data || data.length === 0) {
        return res.status(404).json({ success: false, error: "Menu item override not found." });
      }

      return res.status(200).json({
        success: true,
        message: "Menu item updated successfully",
        data: data[0]
      });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (error) {
    console.error("[Supabase Menu API Error]:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error"
    });
  }
}
