import { createClient } from '@insforge/sdk';

const baseUrl = 'https://vb9ucr22.us-east.insforge.app';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNzQ3MjZ9.CORVtgdxoKKq0AhdUN0RY8s1h3jHMUF3ZOB0CpmnoYk';

const client = createClient({ baseUrl, anonKey });

// The known valid database columns for table `printer_settings`:
export const PRINTER_SETTINGS_DB_COLUMNS = [
  'id',
  'printer_model',
  'active_printer_name',
  'connection_mode',
  'kot_paper_width',
  'kot_printable_width',
  'kot_top_margin',
  'kot_bottom_feed',
  'kot_font_size',
  'kot_auto_cut',
  'kot_item_separator',
  'bill_paper_width',
  'bill_printable_width',
  'bill_top_margin',
  'bill_bottom_feed',
  'bill_auto_cut',
  'bill_show_logo',
  'bill_logo_url',
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
  'updated_at'
];

export function sanitizePrinterSettingsForDB(settings) {
  const sanitized = {};
  for (const col of PRINTER_SETTINGS_DB_COLUMNS) {
    if (settings[col] !== undefined) {
      sanitized[col] = settings[col];
    }
  }
  sanitized.id = 'default';
  sanitized.updated_at = new Date().toISOString();
  return sanitized;
}

async function run() {
  const sample = {
    id: 'default',
    printer_model: 'TVS RP3200 Plus',
    active_printer_name: 'TVS RP3200 Plus',
    connection_mode: 'driver',
    kot_paper_width: 80,
    kot_printable_width: 72,
    kot_top_margin: 0,
    kot_bottom_feed: 3,
    kot_font_size: 'large',
    kot_auto_cut: 'partial',
    kot_item_separator: 'dashed',
    bill_paper_width: 80,
    bill_printable_width: 72,
    bill_top_margin: 0,
    bill_bottom_feed: 4,
    bill_auto_cut: 'full',
    bill_show_logo: true,
    bill_logo_url: '/images/logo.png',
    bill_show_header: true,
    bill_show_tax_summary: true,
    bill_show_payment_mode: true,
    bill_show_upi_qr: true,
    restaurant_name: 'LIMRA RESTAURANT',
    restaurant_address: 'Nimtala, Alanggiri, Egra, West Bengal 721429',
    restaurant_phone: '9635545808',
    restaurant_gstin: '19BWHPA4482J1ZA',
    restaurant_fssai: '',
    cgst_rate: 2.5,
    sgst_rate: 2.5,
    bill_upi_id: '7501299357@YBL',
    bill_upi_payee_name: 'LIMRA RESTAURANT',
    bill_footer_message: 'Thank you for dining with us! Please visit again.',
    kot_show_table: true,
    kot_show_order_type: true,
    kot_show_customer: true,
    kot_show_timestamp: true,
    kot_show_item_notes: true,
    kot_highlight_qty: true,
    kot_show_category: false
  };

  const payload = sanitizePrinterSettingsForDB(sample);
  console.log('Sanitized payload:', payload);

  const res = await client.database.from('printer_settings').upsert([payload]);
  console.log('Upsert result:', res);

  const fetchRes = await client.database.from('printer_settings').select('*').eq('id', 'default').single();
  console.log('Fetched saved row from DB:', fetchRes);
}

run().catch(console.error);
