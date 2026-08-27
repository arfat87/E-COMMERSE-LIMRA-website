import { registerInsforgeTools } from "../package/dist/chunk-VMC7ZO3K.js";
import { createClient } from "@insforge/sdk";

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

  const sql = `
    CREATE TABLE IF NOT EXISTS public.stock_items (
      id text PRIMARY KEY,
      sku text,
      name text NOT NULL,
      category text,
      unit text DEFAULT 'pcs',
      qty numeric DEFAULT 0,
      min_qty numeric DEFAULT 5,
      cost_price numeric DEFAULT 0,
      sale_price numeric DEFAULT 0,
      godown text DEFAULT 'Main Godown',
      supplier text,
      is_available boolean DEFAULT true,
      updated_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.stock_in (
      id text PRIMARY KEY,
      date text,
      item_id text,
      item_sku text,
      item_name text,
      qty numeric DEFAULT 0,
      unit text,
      cost_price numeric DEFAULT 0,
      supplier text,
      notes text,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.stock_out (
      id text PRIMARY KEY,
      date text,
      item_id text,
      item_sku text,
      item_name text,
      qty numeric DEFAULT 0,
      unit text,
      used_by text,
      notes text,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.stock_logs (
      id text PRIMARY KEY,
      action text,
      details text,
      created_at timestamptz DEFAULT now()
    );

    ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.stock_in ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.stock_out ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.stock_logs ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Allow public all stock_items" ON public.stock_items;
    CREATE POLICY "Allow public all stock_items" ON public.stock_items FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow public all stock_in" ON public.stock_in;
    CREATE POLICY "Allow public all stock_in" ON public.stock_in FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow public all stock_out" ON public.stock_out;
    CREATE POLICY "Allow public all stock_out" ON public.stock_out FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow public all stock_logs" ON public.stock_logs;
    CREATE POLICY "Allow public all stock_logs" ON public.stock_logs FOR ALL USING (true) WITH CHECK (true);
  `;

  console.log("Running raw SQL to create and configure tables...");
  const res = await tools["run-raw-sql"]({ query: sql });
  console.log("SQL Result:", JSON.stringify(res, null, 2));
}

main().catch(console.error);
