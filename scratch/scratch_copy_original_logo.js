import fs from 'fs';
import path from 'path';

const srcLogo = 'c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/public/images/logo.png';

const targets = [
  'c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/app/public/images/logo.png',
  'c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/deploy_temp/public/images/logo.png'
];

if (fs.existsSync(srcLogo)) {
  for (const target of targets) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(srcLogo, target);
    console.log('Restored original logo copied successfully to:', target);
  }
} else {
  console.log('Source logo file not found at:', srcLogo);
}
