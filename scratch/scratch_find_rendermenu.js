import fs from 'fs';

const files = ['c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/src/main.js'];
files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('renderMenuGrid')) {
      console.log(`[Line ${idx + 1}]: ${line.trim()}`);
    }
  });
});
