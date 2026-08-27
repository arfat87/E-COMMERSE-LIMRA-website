import fs from 'fs';

const content = fs.readFileSync('src/main.js', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
  if (line.includes('.from(')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
