import fs from 'node:fs';
import path from 'node:path';

function walk(dir) {
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (f === 'node_modules' || f === '.git' || f === 'dist' || f === '.vite') return;
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.css')) {
      const content = fs.readFileSync(p, 'utf8');
      if (/google_translate|googtrans|language-select|lang-select|langToggle|i18n|translateElement/i.test(content)) {
        console.log(`MATCH IN FILE: ${p}`);
      }
    }
  });
}
walk('.');
console.log('Search complete.');
