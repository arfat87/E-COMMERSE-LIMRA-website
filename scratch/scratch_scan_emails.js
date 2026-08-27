import fs from 'fs';
import path from 'path';

const FILES = [
  'src/admin-login.js',
  'src/admin.js',
  'src/main.js',
  'admin-login.html',
  'admin.html',
  'index.html',
  'scripts/grant-admin.sql'
];

function scan() {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  for (const f of FILES) {
    if (!fs.existsSync(f)) continue;
    const content = fs.readFileSync(f, 'utf8');
    const matches = content.match(emailRegex);
    if (matches) {
      console.log(`--- ${f} ---`);
      console.log([...new Set(matches)]);
    }
  }
}

scan();
