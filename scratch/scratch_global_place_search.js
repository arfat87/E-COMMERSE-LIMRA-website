import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      if (f !== 'node_modules' && f !== '.git' && f !== 'dist') {
        walkDir(dirPath, callback);
      }
    } else {
      callback(dirPath);
    }
  });
}

console.log('=== SEARCHING FOR DATABASE PLACEMENTS IN ALL JS FILES ===');
walkDir('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA', (filePath) => {
  if (!filePath.endsWith('.js') && !filePath.endsWith('.mjs') && !filePath.endsWith('.html')) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('place_order') || line.includes('place_booking') || line.includes('get_customer_bookings') || line.includes('get_customer_orders')) {
      console.log(`[${path.relative('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA', filePath)}:${idx + 1}]: ${line.trim()}`);
    }
  });
});
