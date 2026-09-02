import { supabase } from "./lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // 1. GET: Retrieve Menu Overrides
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

    // 2. POST / UPSERT Menu Item Override
    if (req.method === "POST") {
      const { id, price, mrp, available = true, featured = false, description = "" } = req.body || {};

      if (!id || price === undefined) {
        return res.status(400).json({ error: "Item id and price are required." });
      }

      const payload = {
        id: Number(id),
        price: Number(price),
        mrp: mrp ? Number(mrp) : null,
        available: available !== false,
        featured: featured === true,
        description: description || "",
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

    // 3. PATCH: Toggle availability or update stock/price
    if (req.method === "PATCH") {
      const { id, available, price, mrp, featured, description } = req.body || {};

      if (!id) {
        return res.status(400).json({ error: "Item id is required." });
      }

      const updatePayload = { updated_at: new Date().toISOString() };
      if (available !== undefined) updatePayload.available = available === true;
      if (price !== undefined) updatePayload.price = Number(price);
      if (mrp !== undefined) updatePayload.mrp = mrp ? Number(mrp) : null;
      if (featured !== undefined) updatePayload.featured = featured === true;
      if (description !== undefined) updatePayload.description = description;

      const { data, error } = await supabase
        .from("menu_overrides")
        .update(updatePayload)
        .eq("id", Number(id))
        .select();

      if (error || !data || data.length === 0) {
        return res.status(404).json({ error: "Menu item override not found." });
      }

      return res.status(200).json({
        success: true,
        message: "Menu item updated successfully",
        data: data[0]
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[Supabase Menu API Error]:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error"
    });
  }
}
