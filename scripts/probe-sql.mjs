const BASE_URL = 'https://vb9ucr22.us-east.insforge.app';
const API_KEY  = 'ik_799af068e8f4fb05944d04497229fe7d';

async function main() {
  const probeEndpoints = [
    '/api/database/sql',
    '/api/migrations/run',
    '/api/sql',
    '/api/v1/database/sql',
  ];

  console.log('Probing endpoints...');
  for (const ep of probeEndpoints) {
    try {
      const r = await fetch(`${BASE_URL}${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ sql: 'SELECT 1;' }),
      });
      const body = await r.text();
      console.log(`  ${ep} → ${r.status} ${body.slice(0, 100)}`);
    } catch (e) {
      console.log(`  ${ep} → ERROR: ${e.message}`);
    }
  }
}

main();
