import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

async function main() {
  const { data, error } = await insforge.database.from('printer_settings').select('*').eq('id', 'default').maybeSingle();
  if (error) {
    console.error("Error reading printer_settings:", error);
    return;
  }
  console.log("printer_settings loaded successfully:");
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
