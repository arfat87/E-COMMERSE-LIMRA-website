import fs from 'fs';
import path from 'path';

const searchTerms = ['food-search-input', 'searchMenuGrid', 'search-input', 'filterMenu'];
const files = [
  'index.html',
  'src/main.js',
  'deploy_temp/index.html',
  'deploy_temp/src/main.js',
  'app/index.html',
  'app/src/main.js'
];

console.log('=== SEARCHING FOR SEARCH WEB SECTION ===');
files.forEach((relPath) => {
  const filePath = path.resolve('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA', relPath);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${relPath}`);
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    searchTerms.forEach((term) => {
      if (line.includes(term)) {
        console.log(`[${relPath}:${idx + 1}] (${term}): ${line.trim()}`);
      }
    });
  });
});
