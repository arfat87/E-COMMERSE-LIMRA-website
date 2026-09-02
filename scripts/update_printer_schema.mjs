const INSFORGE_URL = "https://vb9ucr22.us-east.insforge.app";
const API_KEY = "ik_799af068e8f4fb05944d04497229fe7d";

async function queryInsforge(sql) {
  const res = await fetch(INSFORGE_URL + "/api/database/advance/rawsql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ query: sql })
  });
  return await res.json();
}

async function main() {
  console.log("Updating printer_settings table schema in PostgreSQL...");
  const sql = `
    ALTER TABLE public.printer_settings 
      ADD COLUMN IF NOT EXISTS bill_show_logo boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS bill_logo_url text DEFAULT '/images/logo.png',
      ADD COLUMN IF NOT EXISTS bill_upi_payee_name text DEFAULT 'LIMRA RESTAURANT',
      ADD COLUMN IF NOT EXISTS kot_side_gap numeric DEFAULT 2,
      ADD COLUMN IF NOT EXISTS bill_side_gap numeric DEFAULT 2,
      ADD COLUMN IF NOT EXISTS bill_font_size numeric DEFAULT 10,
      ADD COLUMN IF NOT EXISTS bill_font_weight text DEFAULT '700',
      ADD COLUMN IF NOT EXISTS bill_density text DEFAULT 'compact',
      ADD COLUMN IF NOT EXISTS bill_bold_items boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS bill_bold_headers boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS bill_bold_totals boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS bill_compact_header boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS bill_qr_size text DEFAULT 'medium',
      ADD COLUMN IF NOT EXISTS bill_show_place boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS bill_show_table boolean DEFAULT true;

    UPDATE public.printer_settings
    SET 
      bill_show_logo = COALESCE(bill_show_logo, true),
      bill_logo_url = COALESCE(bill_logo_url, '/images/logo.png'),
      bill_upi_payee_name = COALESCE(bill_upi_payee_name, 'LIMRA RESTAURANT'),
      kot_side_gap = COALESCE(kot_side_gap, 2),
      bill_side_gap = COALESCE(bill_side_gap, 2),
      bill_font_size = 11.5,
      bill_font_weight = '800',
      bill_density = COALESCE(bill_density, 'compact'),
      bill_bold_items = true,
      bill_bold_headers = true,
      bill_bold_totals = true,
      bill_compact_header = COALESCE(bill_compact_header, false),
      bill_qr_size = COALESCE(bill_qr_size, 'medium'),
      bill_show_place = COALESCE(bill_show_place, true),
      bill_show_table = COALESCE(bill_show_table, true)
    WHERE id = 'default';
  `;

  const res = await queryInsforge(sql);
  console.log("printer_settings schema update result:", JSON.stringify(res, null, 2));
}

main().catch(console.error);
