import fs from 'fs';

const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');

console.log('=== FLOATING / FIXED POSITIONED ELEMENTS ===');
lines.forEach((line, idx) => {
  if (line.includes('fixed') || line.includes('absolute') || line.includes('bottom-')) {
    if (line.includes('class=') && !line.includes('cart-drawer') && !line.includes('auth-drawer') && !line.includes('cart-overlay')) {
      console.log(`[Line ${idx + 1}]: ${line.trim()}`);
    }
  }
});
