import fs from 'fs';

const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');

console.log('=== CART REFERENCES IN INDEX.HTML ===');
lines.forEach((line, idx) => {
  if (line.includes('cart-toggle') || line.includes('cart-btn') || line.includes('view-cart') || line.includes('floating') || line.includes('float')) {
    console.log(`[Line ${idx + 1}]: ${line.trim()}`);
  }
});
