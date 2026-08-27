import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://vb9ucr22.us-east.insforge.app';
const API_KEY  = 'ik_799af068e8f4fb05944d04497229fe7d';

async function main() {
  console.log('\n===================================================');
  console.log(' LIMRA Restaurant - Notifications Schema Hotfix');
  console.log('===================================================\n');

  const migrationFile = path.resolve('migrations/20260613010000_fix_notifications_item_id.sql');
  if (!fs.existsSync(migrationFile)) {
    console.error(`Error: Migration file not found at ${migrationFile}`);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(migrationFile, 'utf8');
  console.log('Reading hotfix file SQL content...');

  const endpoint = '/api/database/advance/rawsql';

  console.log(`Executing SQL hotfix via ${endpoint}...`);
  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify({
        query: sqlContent,
        params: []
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    console.log('✅ Hotfix SQL applied successfully!');
    console.log('Response:', body);
  } catch (err) {
    console.error('❌ SQL Hotfix execution failed:', err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
