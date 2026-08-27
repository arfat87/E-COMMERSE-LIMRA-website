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

  console.log("Updating printer_settings table schema in PostgreSQL...");
  const sql = `
    ALTER TABLE public.printer_settings 
      ADD COLUMN IF NOT EXISTS bill_show_logo boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS bill_logo_url text DEFAULT '/images/logo.png',
      ADD COLUMN IF NOT EXISTS bill_upi_payee_name text DEFAULT 'LIMRA RESTAURANT';

    UPDATE public.printer_settings
    SET 
      bill_show_logo = COALESCE(bill_show_logo, true),
      bill_logo_url = COALESCE(bill_logo_url, '/images/logo.png'),
      bill_upi_payee_name = COALESCE(bill_upi_payee_name, 'LIMRA RESTAURANT')
    WHERE id = 'default';
  `;

  const res = await tools["run-raw-sql"]({ query: sql });
  console.log("printer_settings schema update result:", JSON.stringify(res, null, 2));
}

main().catch(console.error);
