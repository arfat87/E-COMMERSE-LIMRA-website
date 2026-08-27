import fs from 'fs';
import path from 'path';

const files = [
  'index.html',
  'src/main.js',
  'deploy_temp/index.html',
  'deploy_temp/src/main.js'
];

console.log('=== VERIFYING BRAND NAME RESTORATION ===');

files.forEach(file => {
  const filePath = path.resolve('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA', file);
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  if (content.toLowerCase().includes('minara') || content.toLowerCase().includes('menara')) {
    console.log(`[WARNING] ${file} contains references to "Minara" / "Menara"`);
    // Find lines
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes('minara') || line.toLowerCase().includes('menara')) {
        console.log(`  Line ${idx + 1}: ${line.trim()}`);
      }
    });
  } else {
    console.log(`[PASS] ${file} contains 0 references to "Minara" / "Menara".`);
  }
});
