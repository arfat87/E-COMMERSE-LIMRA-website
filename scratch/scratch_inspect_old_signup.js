import fs from 'fs';

function printLines(file, start, count) {
  if (fs.existsSync(file)) {
    console.log(`=== File: ${file} ===`);
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    console.log(lines.slice(start - 1, start - 1 + count).join('\n'));
  }
}

printLines('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/src/main.js', 1815, 25);
printLines('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/src/admin-login.js', 145, 25);
