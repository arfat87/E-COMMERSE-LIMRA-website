import { readFileSync } from 'fs';

const src = readFileSync('node_modules/@insforge/sdk/dist/index.mjs', 'utf8');

// Find the PostgREST base URL construction
const pgIdx = src.indexOf('postgrest');
if (pgIdx > -1) {
  console.log('=== Around "postgrest" ===');
  console.log(src.slice(Math.max(0, pgIdx - 200), pgIdx + 400));
}

// Find URL path patterns
const pathRe = /"\/[a-z][a-z0-9/_-]{2,}"/g;
const paths = new Set();
let m;
while ((m = pathRe.exec(src)) !== null) {
  const p = m[0];
  if (p.includes('rest') || p.includes('sql') || p.includes('rpc') || p.includes('query') || p.includes('pg')) {
    paths.add(p);
  }
}
console.log('\n=== Matching paths ===');
for (const p of paths) console.log(p);

// Find createClient baseUrl usage
const clientIdx = src.indexOf('createClient');
if (clientIdx > -1) {
  console.log('\n=== createClient context ===');
  console.log(src.slice(clientIdx, clientIdx + 800));
}
