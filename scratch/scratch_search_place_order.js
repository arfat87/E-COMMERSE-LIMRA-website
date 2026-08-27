import fs from 'fs';

const content = fs.readFileSync('src/main.js', 'utf8');
const lines = content.split('\n');

console.log('=== ORDER/BOOKING PLACEMENT SEARCH ===');
lines.forEach((line, idx) => {
  const l = line.toLowerCase();
  if (l.includes('place_') || l.includes('placeorder') || l.includes('placebooking') || l.includes('insert(') || l.includes('insert (')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
