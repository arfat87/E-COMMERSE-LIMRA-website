import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

async function main() {
  const testPayload = {
    id: "default",
    printer_model: "TVS RP3200 Plus",
    active_printer_name: "TVS RP3200 Plus",
    connection_mode: "driver",
    kot_paper_width: 80,
    kot_printable_width: 72,
    kot_side_gap: 2,
    kot_top_margin: 0,
    kot_bottom_feed: 3,
    kot_font_size: "large",
    kot_auto_cut: "partial",
    kot_item_separator: "dashed",
    bill_paper_width: 80,
    bill_printable_width: 72,
    bill_side_gap: 2,
    bill_top_margin: 0,
    bill_bottom_feed: 4,
    bill_auto_cut: "full",
    bill_show_logo: true,
    bill_logo_url: "/images/logo.png",
    bill_show_place: true,
    bill_show_table: true,
    bill_show_header: true,
    bill_show_tax_summary: true,
    bill_show_payment_mode: true,
    bill_show_upi_qr: true,
    restaurant_name: "LIMRA RESTAURANT",
    restaurant_address: "Nimtala, Alanggiri, Egra, West Bengal 721429",
    restaurant_phone: "9635545808",
    restaurant_gstin: "19BWHPA4482J1ZA",
    restaurant_fssai: "",
    cgst_rate: 2.5,
    sgst_rate: 2.5,
    bill_upi_id: "7501299357@YBL",
    bill_upi_payee_name: "LIMRA RESTAURANT",
    bill_footer_message: "Thank you for dining with us! Please visit again.",
    kot_show_table: true,
    kot_show_order_type: true,
    kot_show_customer: true,
    kot_show_timestamp: true,
    kot_show_item_notes: true,
    kot_show_category: false,
    kot_highlight_qty: true,
    bill_font_size: 11.5,
    bill_font_weight: "800",
    bill_density: "compact",
    bill_bold_items: true,
    bill_bold_headers: true,
    bill_bold_totals: true,
    bill_compact_header: false,
    bill_qr_size: "medium",
    updated_at: new Date().toISOString()
  };

  console.log("Upserting printer_settings...");
  const { error: upsertErr } = await insforge.database.from('printer_settings').upsert([testPayload]);
  if (upsertErr) {
    console.error("Upsert failed:", upsertErr);
    return;
  }
  console.log("Upsert successful!");

  const { data, error } = await insforge.database.from('printer_settings').select('*').eq('id', 'default').maybeSingle();
  if (error) {
    console.error("Error reading printer_settings:", error);
    return;
  }
  console.log("printer_settings loaded successfully:");
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
