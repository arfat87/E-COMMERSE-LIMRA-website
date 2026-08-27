import fs from 'fs';
import path from 'path';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
        results = results.concat(walk(fullPath));
      }
    } else {
      results.push(fullPath);
    }
  });
  return results;
}

const allFiles = walk('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA');
for (const file of allFiles) {
  if (file.endsWith('.js') || file.endsWith('.html') || file.endsWith('.vue') || file.endsWith('.ts') || file.endsWith('.css') || file.endsWith('.json') || file.endsWith('.xml')) {
    const content = fs.readFileSync(file, 'utf8');
    const lower = content.toLowerCase();
    if (lower.includes('arif')) {
      console.log(`Found match in: ${file}`);
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('arif')) {
          console.log(`  [Line ${idx + 1}]: ${line.trim()}`);
        }
      });
    }
  }
}
