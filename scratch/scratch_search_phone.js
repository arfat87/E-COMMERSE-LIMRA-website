import fs from 'fs';
import path from 'path';

const searchDirs = ['.', 'src', 'migrations', 'scratch'];
const target = '9876543210';

searchDirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  files.forEach(f => {
    const filePath = path.join(dir, f);
    if (fs.statSync(filePath).isDirectory()) return;
    if (f.endsWith('.js') || f.endsWith('.sql') || f.endsWith('.json') || f.endsWith('.html') || f.endsWith('.mjs')) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes(target)) {
        console.log(`Match in ${filePath}:`);
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (line.includes(target)) {
            console.log(`  Line ${idx + 1}: ${line.trim()}`);
          }
        });
      }
    }
  });
});
