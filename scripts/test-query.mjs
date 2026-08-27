const BASE_URL = 'https://vb9ucr22.us-east.insforge.app';
const API_KEY  = 'ik_799af068e8f4fb05944d04497229fe7d';

async function runSql(sql) {
  const res = await fetch(`${BASE_URL}/api/database/advance/rawsql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify({
      query: sql,
      params: []
    })
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function test() {
  try {
    console.log('--- Definition of place_order ---');
    const funcDef = await runSql(
      "SELECT pg_get_functiondef('public.place_order(text, text, text, jsonb, numeric, numeric, text, text, boolean, text, integer, text)'::regprocedure);"
    );
    console.log(funcDef.rows[0].pg_get_functiondef);
  } catch (err) {
    console.error('Query failed:', err);
  }
}

test();
