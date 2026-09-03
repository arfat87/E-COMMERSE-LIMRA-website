import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ynrtlcasbndkrqeotgzt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlucnRsY2FzYm5ka3JxZW90Z3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzMTgyMjEsImV4cCI6MjEwMzg5NDIyMX0.xTeCPhHFhlGz3fm6hcfstN1DPWuhhRSlLJnXtTCOkm4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PRINTER_SETTINGS_DB_COLUMNS = [
  'id',
  'printer_model',
  'active_printer_name',
  'connection_mode',
  'kot_paper_width',
  'kot_printable_width',
  'kot_side_gap',
  'kot_top_margin',
  'kot_bottom_feed',
  'kot_font_size',
  'kot_auto_cut',
  'kot_item_separator',
  'bill_paper_width',
  'bill_printable_width',
  'bill_side_gap',
  'bill_top_margin',
  'bill_bottom_feed',
  'bill_auto_cut',
  'bill_show_logo',
  'bill_logo_url',
  'bill_show_place',
  'bill_show_table',
  'bill_show_header',
  'bill_show_tax_summary',
  'bill_show_payment_mode',
  'bill_show_upi_qr',
  'restaurant_name',
  'restaurant_address',
  'restaurant_phone',
  'restaurant_gstin',
  'restaurant_fssai',
  'cgst_rate',
  'sgst_rate',
  'bill_upi_id',
  'bill_upi_payee_name',
  'bill_footer_message',
  'kot_show_table',
  'kot_show_order_type',
  'kot_show_customer',
  'kot_show_timestamp',
  'kot_show_item_notes',
  'kot_show_category',
  'kot_highlight_qty',
  'bill_font_size',
  'bill_font_weight',
  'bill_density',
  'bill_bold_items',
  'bill_bold_headers',
  'bill_bold_totals',
  'bill_compact_header',
  'bill_qr_size',
  'updated_at'
];

async function test() {
  const payload = {
    id: 'default',
    printer_model: 'TVS RP3200 Plus - Custom',
    active_printer_name: 'TVS RP3200 Plus',
    kot_paper_width: 80,
    bill_paper_width: 80,
    restaurant_name: 'LIMRA RESTAURANT EGRA',
    restaurant_phone: '9635545808',
    bill_bold_headers: true,
    bill_font_size: 11,
    kot_side_gap: 3,
    updated_at: new Date().toISOString()
  };

  console.log("Testing self-healing upsert...");
  let res = await supabase.from('printer_settings').upsert([payload]);
  let strippedCols = [];

  let attempts = 0;
  while (res.error && res.error.message && res.error.message.includes('Could not find the') && attempts < 20) {
    const match = res.error.message.match(/Could not find the '([^']+)' column/);
    if (match && match[1]) {
      strippedCols.push(match[1]);
      delete payload[match[1]];
      res = await supabase.from('printer_settings').upsert([payload]);
    } else {
      break;
    }
    attempts++;
  }

  if (res.error) {
    console.error("Final Error:", res.error.message);
  } else {
    console.log("✅ Self-healing save succeeded! Stripped unrecognized columns:", strippedCols);
    
    // Verify by reading back
    const { data } = await supabase.from('printer_settings').select('*').eq('id', 'default').single();
    console.log("Read back from database:", {
      printer_model: data.printer_model,
      restaurant_name: data.restaurant_name,
      kot_paper_width: data.kot_paper_width,
      bill_paper_width: data.bill_paper_width,
      updated_at: data.updated_at
    });
  }
}

test();
