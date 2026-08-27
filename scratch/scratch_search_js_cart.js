import fs from 'fs';

const content = fs.readFileSync('src/main.js', 'utf8');
const lines = content.split('\n');

console.log('=== CART REFERENCES IN SRC/MAIN.JS ===');
lines.forEach((line, idx) => {
  if (line.includes('view-cart-btn') || line.includes('cart-drawer') || line.includes('cart-toggle') || line.includes('updateCartUI')) {
    console.log(`[Line ${idx + 1}]: ${line.trim()}`);
  }
});
