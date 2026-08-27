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

const allFiles = walk('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/app');
allFiles.forEach(file => {
  if (file.endsWith('.js') || file.endsWith('.html')) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.toLowerCase().includes('arif') || content.toLowerCase().includes('menara') || content.toLowerCase().includes('bibi')) {
      console.log(`Match in app file: ${file}`);
    }
  }
});
