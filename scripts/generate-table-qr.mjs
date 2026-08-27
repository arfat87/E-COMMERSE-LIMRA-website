// This script generates 19 QR code PNG images, one per table
// Uses the 'qrcode' npm package
// Output: public/images/qr/table-1.png ... table-19.png

import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://limraresturent.in/table/?t=';
const OUTPUT_DIR = './public/images/qr/';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

for (let i = 1; i <= 19; i++) {
  const url = `${BASE_URL}${i}`;
  const outputPath = path.join(OUTPUT_DIR, `table-${i}.png`);
  
  await QRCode.toFile(outputPath, url, {
    color: { dark: '#c8860a', light: '#1a1a1a' },  // LIMRA gold on dark
    width: 400,
    margin: 2,
    errorCorrectionLevel: 'H'
  });
  
  console.log(`✅ QR for Table ${i} → ${url}`);
}

console.log('\n🎉 All 19 QR codes generated in public/images/qr/');
