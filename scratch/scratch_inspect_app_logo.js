import fs from 'fs';

const file = 'c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/app/index.html';
if (fs.existsSync(file)) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('logo') || line.includes('logo.png') || line.includes('Logo')) {
      console.log(`[Line ${idx + 1}]: ${line.trim()}`);
    }
  });
}
