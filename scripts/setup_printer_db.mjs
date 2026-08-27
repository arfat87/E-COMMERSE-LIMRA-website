import { registerInsforgeTools } from "../package/dist/chunk-VMC7ZO3K.js";

const tools = {};
const mockServer = {
  tool(name, ...args) {
    const handler = args[args.length - 1];
    tools[name] = handler;
  }
};

async function main() {
  const config = {
    apiKey: "ik_799af068e8f4fb05944d04497229fe7d",
    apiBaseUrl: "https://vb9ucr22.us-east.insforge.app",
    mode: "local"
  };
  
  await registerInsforgeTools(mockServer, config);

  console.log("Creating printer_settings table in PostgreSQL...");
  const sql = `
    CREATE TABLE IF NOT EXISTS public.printer_settings (
      id text PRIMARY KEY,
      printer_model text DEFAULT 'TVS RP3200 Plus',
      active_printer_name text,
      connection_mode text DEFAULT 'qz_tray',
      
      -- Dimensions & Sizing
      kot_paper_width numeric DEFAULT 80,
      kot_printable_width numeric DEFAULT 72,
      kot_top_margin numeric DEFAULT 0,
      kot_bottom_feed numeric DEFAULT 3,
      kot_font_size text DEFAULT 'large',
      kot_auto_cut text DEFAULT 'partial',
      
      bill_paper_width numeric DEFAULT 80,
      bill_printable_width numeric DEFAULT 72,
      bill_top_margin numeric DEFAULT 0,
      bill_bottom_feed numeric DEFAULT 4,
      bill_auto_cut text DEFAULT 'full',
      
      -- Content & Branding Preferences
      restaurant_name text DEFAULT 'LIMRA RESTAURANT',
      restaurant_address text DEFAULT 'Main Road, Near Bus Stand',
      restaurant_phone text DEFAULT '+91 98765 43210',
      restaurant_gstin text DEFAULT '',
      restaurant_fssai text DEFAULT '',
      cgst_rate numeric DEFAULT 2.5,
      sgst_rate numeric DEFAULT 2.5,
      
      -- KOT Layout Options
      kot_show_table boolean DEFAULT true,
      kot_show_order_type boolean DEFAULT true,
      kot_show_customer boolean DEFAULT true,
      kot_show_timestamp boolean DEFAULT true,
      kot_show_item_notes boolean DEFAULT true,
      kot_show_category boolean DEFAULT false,
      kot_highlight_qty boolean DEFAULT true,
      kot_item_separator text DEFAULT 'dashed',
      
      -- Bill Layout Options
      bill_show_header boolean DEFAULT true,
      bill_show_tax_summary boolean DEFAULT true,
      bill_show_payment_mode boolean DEFAULT true,
      bill_show_upi_qr boolean DEFAULT true,
      bill_upi_id text DEFAULT '',
      bill_footer_message text DEFAULT 'Thank you for dining with us! Please visit again.',
      
      updated_at timestamptz DEFAULT now()
    );

    ALTER TABLE public.printer_settings ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "printer_settings_all" ON public.printer_settings;
    CREATE POLICY "printer_settings_all" ON public.printer_settings FOR ALL USING (true) WITH CHECK (true);

    -- Insert default row if not exists
    INSERT INTO public.printer_settings (id, printer_model, kot_paper_width, bill_paper_width)
    VALUES ('default', 'TVS RP3200 Plus', 80, 80)
    ON CONFLICT (id) DO NOTHING;
  `;

  const res = await tools["run-raw-sql"]({ query: sql });
  console.log("printer_settings setup result:", JSON.stringify(res, null, 2));
}

main().catch(console.error);
