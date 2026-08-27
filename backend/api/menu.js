import { queryInsforge } from "./lib/insforge.js";

function sqlEscape(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  if (typeof val === "object") {
    if (val instanceof Date) return `'${val.toISOString()}'`;
    return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

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
      const overrides = await queryInsforge("SELECT * FROM public.menu_overrides ORDER BY id ASC;");
      return res.status(200).json({
        success: true,
        count: overrides.length,
        data: overrides
      });
    }

    // 2. POST / UPSERT Menu Item Override
    if (req.method === "POST") {
      const { id, price, mrp, available = true, featured = false, description = "" } = req.body || {};

      if (!id || price === undefined) {
        return res.status(400).json({ error: "Item id and price are required." });
      }

      const numId = Number(id);
      const numPrice = Number(price);
      const numMrp = mrp ? Number(mrp) : "NULL";
      const isAvailable = available !== false;
      const isFeatured = featured === true;
      const desc = sqlEscape(description || "");

      const result = await queryInsforge(`
        INSERT INTO public.menu_overrides (id, price, available, featured, mrp, description, updated_at)
        VALUES (${numId}, ${numPrice}, ${isAvailable}, ${isFeatured}, ${numMrp}, ${desc}, NOW())
        ON CONFLICT (id) DO UPDATE SET
          price = EXCLUDED.price,
          available = EXCLUDED.available,
          featured = EXCLUDED.featured,
          mrp = EXCLUDED.mrp,
          description = EXCLUDED.description,
          updated_at = NOW()
        RETURNING *;
      `);

      return res.status(200).json({
        success: true,
        data: result[0]
      });
    }

    // 3. PATCH: Toggle availability or update stock/price
    if (req.method === "PATCH") {
      const { id, available, price, mrp, featured, description } = req.body || {};

      if (!id) {
        return res.status(400).json({ error: "Item id is required." });
      }

      const setClauses = ["updated_at = NOW()"];
      if (available !== undefined) setClauses.push(`available = ${available ? "TRUE" : "FALSE"}`);
      if (price !== undefined) setClauses.push(`price = ${Number(price)}`);
      if (mrp !== undefined) setClauses.push(`mrp = ${mrp ? Number(mrp) : "NULL"}`);
      if (featured !== undefined) setClauses.push(`featured = ${featured ? "TRUE" : "FALSE"}`);
      if (description !== undefined) setClauses.push(`description = ${sqlEscape(description)}`);

      const result = await queryInsforge(`
        UPDATE public.menu_overrides 
        SET ${setClauses.join(", ")} 
        WHERE id = ${Number(id)} 
        RETURNING *;
      `);

      if (!result || result.length === 0) {
        return res.status(404).json({ error: "Menu item override not found." });
      }

      return res.status(200).json({
        success: true,
        message: "Menu item updated successfully",
        data: result[0]
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("InsForge Menu API Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error"
    });
  }
}
