import fs from 'fs';

const content = fs.readFileSync('deploy_temp/index.html', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
  if (line.includes('back-to-top')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
