import fs from 'fs';

const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');

console.log('=== ALL WA-FAB OR BACK-TO-TOP STYLES ===');
lines.forEach((line, idx) => {
  if (line.includes('wa-fab') || line.includes('back-to-top')) {
    console.log(`[Line ${idx + 1}]: ${line.trim()}`);
  }
});
