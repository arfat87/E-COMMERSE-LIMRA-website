import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://vb9ucr22.us-east.insforge.app';
const API_KEY  = 'ik_799af068e8f4fb05944d04497229fe7d';

async function main() {
  const query = `
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename;
  `;

  const endpoint = '/api/database/advance/rawsql';
  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify({ query, params: [] }),
    });
    const body = await res.json();
    console.log(JSON.stringify(body, null, 2));
  } catch (err) {
    console.error('Probe failed:', err.message);
  }
}

main();
