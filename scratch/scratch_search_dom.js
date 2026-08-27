import fs from 'fs';
const content = fs.readFileSync('deploy_temp/src/main.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('DOMContentLoaded')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
