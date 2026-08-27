import fs from 'fs';
const content = fs.readFileSync('deploy_temp/src/main.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('function renderMenuGrid')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
