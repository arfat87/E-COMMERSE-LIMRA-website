import fs from 'fs';

const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');

console.log('=== FLOATING CART OR FIXED ELEMENTS IN INDEX.HTML ===');
lines.forEach((line, idx) => {
  if (line.includes('cart') && (line.includes('fixed') || line.includes('bottom') || line.includes('right') || line.includes('z-'))) {
    console.log(`[Line ${idx + 1}]: ${line.trim()}`);
  }
});
