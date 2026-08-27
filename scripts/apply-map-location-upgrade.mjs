import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://vb9ucr22.us-east.insforge.app';
const API_KEY  = 'ik_799af068e8f4fb05944d04497229fe7d';

async function main() {
  console.log('\n===================================================');
  console.log(' LIMRA Restaurant - Map & Location Schema Upgrade');
  console.log('===================================================\n');

  const migrationFile = path.resolve('migrations/20260603000000_map_location_upgrade.sql');
  if (!fs.existsSync(migrationFile)) {
    console.error(`Error: Migration file not found at ${migrationFile}`);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(migrationFile, 'utf8');
  console.log('Reading migration file SQL content...');

  const endpoints = [
    '/api/database/sql',
    '/api/migrations/run',
    '/api/sql',
  ];

  let workingEndpoint = null;
  console.log('Probing database endpoints...');
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${BASE_URL}${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ sql: 'SELECT 1;' }),
      });
      const body = await res.text();
      if (res.status !== 404) {
        console.log(`  ${ep} -> OK (status ${res.status})`);
        workingEndpoint = ep;
        break;
      }
    } catch (e) {
      console.log(`  ${ep} -> FAILED: ${e.message}`);
    }
  }

  if (!workingEndpoint) {
    console.error('Error: Could not identify working SQL execution endpoint on backend.');
    process.exit(1);
  }

  console.log(`Executing SQL migration via ${workingEndpoint}...`);
  try {
    const res = await fetch(`${BASE_URL}${workingEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ sql: sqlContent }),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    console.log('✅ Migration SQL applied successfully!');
    console.log('Database schema successfully upgraded.');
  } catch (err) {
    console.error('❌ SQL Migration execution failed:', err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
