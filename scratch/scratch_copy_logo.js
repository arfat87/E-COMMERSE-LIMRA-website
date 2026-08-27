import fs from 'fs';
import path from 'path';

const srcLogo = 'C:\\Users\\salim\\.gemini\\antigravity\\brain\\e2a7b0b0-06e1-4dbd-b9f2-d64d09e6c3d2\\limra_logo_1780470566074.png';

const targets = [
  'c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/public/images/logo.png',
  'c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/app/public/images/logo.png',
  'c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/deploy_temp/public/images/logo.png'
];

if (fs.existsSync(srcLogo)) {
  for (const target of targets) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log('Created directory:', dir);
    }
    fs.copyFileSync(srcLogo, target);
    console.log('Copied logo successfully to:', target);
  }
} else {
  console.log('Source logo file not found at:', srcLogo);
}
