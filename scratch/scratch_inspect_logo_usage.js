import fs from 'fs';

const content = fs.readFileSync('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/index.html', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('logo') || line.includes('logo.png') || line.includes('firmLogo')) {
    console.log(`[Line ${idx + 1}]: ${line.trim()}`);
  }
});
