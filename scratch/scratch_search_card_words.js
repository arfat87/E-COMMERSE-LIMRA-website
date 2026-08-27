import fs from 'fs';

const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');

console.log('=== CARD OCCURRENCES ===');
lines.forEach((line, idx) => {
  if (line.toLowerCase().includes('card')) {
    console.log(`[Line ${idx + 1}]: ${line.trim()}`);
  }
});
