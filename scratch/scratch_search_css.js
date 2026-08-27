import fs from 'fs';

const content = fs.readFileSync('src/style.css', 'utf8');
const lines = content.split('\n');

console.log('=== CSS REFERENCES IN SRC/STYLE.CSS ===');
lines.forEach((line, idx) => {
  if (line.includes('wa-fab') || line.includes('back-to-top') || line.includes('floating')) {
    console.log(`[Line ${idx + 1}]: ${line.trim()}`);
  }
});
