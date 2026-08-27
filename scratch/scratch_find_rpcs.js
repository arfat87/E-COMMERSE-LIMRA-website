import fs from 'fs';
import path from 'path';

const files = [
  'src/main.js',
  'src/admin.js',
  'src/admin-login.js'
];

console.log('=== SEARCHING FOR RPC CALLS ===');
files.forEach(file => {
  const filePath = path.resolve('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA', file);
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('.rpc(') || line.includes('rpc(') || line.includes('from(')) {
      console.log(`[${file}:${idx + 1}]: ${line.trim()}`);
    }
  });
});
