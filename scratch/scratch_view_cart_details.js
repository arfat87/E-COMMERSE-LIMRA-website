import fs from 'fs';

const mainContent = fs.readFileSync('src/main.js', 'utf8');
const linesMain = mainContent.split('\n');
console.log('=== MAIN.JS ===');
linesMain.forEach((line, idx) => {
  if (line.includes('view-cart-btn') || line.includes('view-cart-badge')) {
    console.log(`[Line ${idx + 1}]: ${line.trim()}`);
  }
});

const tempContent = fs.readFileSync('deploy_temp/src/main.js', 'utf8');
const linesTemp = tempContent.split('\n');
console.log('=== DEPLOY_TEMP/MAIN.JS ===');
linesTemp.forEach((line, idx) => {
  if (line.includes('view-cart-btn') || line.includes('view-cart-badge')) {
    console.log(`[Line ${idx + 1}]: ${line.trim()}`);
  }
});
