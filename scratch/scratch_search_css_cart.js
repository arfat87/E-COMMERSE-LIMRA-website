import fs from 'fs';

const mainCSS = fs.readFileSync('src/style.css', 'utf8');
console.log('=== main.css view-cart-btn references ===');
mainCSS.split('\n').forEach((line, idx) => {
  if (line.includes('view-cart-btn') || line.includes('view-cart')) {
    console.log(`[Line ${idx + 1}]: ${line.trim()}`);
  }
});

const tempCSS = fs.readFileSync('deploy_temp/src/style.css', 'utf8');
console.log('=== deploy_temp/style.css view-cart-btn references ===');
tempCSS.split('\n').forEach((line, idx) => {
  if (line.includes('view-cart-btn') || line.includes('view-cart')) {
    console.log(`[Line ${idx + 1}]: ${line.trim()}`);
  }
});
