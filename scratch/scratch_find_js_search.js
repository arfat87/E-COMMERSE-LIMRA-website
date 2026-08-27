import fs from 'fs';

const file = 'c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/src/main.js';
const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

console.log('=== SEARCH LOGIC IN ROOT SRC/MAIN.JS ===');
lines.forEach((line, idx) => {
  if (line.includes('search') || line.includes('Search') || line.includes('search-input') || line.includes('filter')) {
    console.log(`[Line ${idx + 1}]: ${line.trim()}`);
  }
});
