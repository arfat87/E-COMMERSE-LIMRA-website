import fs from 'fs';

const file = 'c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/app/index.html';
if (fs.existsSync(file)) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  console.log('=== SEARCH SECTIONS IN APP INDEX.HTML ===');
  lines.forEach((line, idx) => {
    if (line.includes('search') || line.includes('Search') || line.includes('search-input')) {
      console.log(`[Line ${idx + 1}]: ${line.trim()}`);
    }
  });
}
