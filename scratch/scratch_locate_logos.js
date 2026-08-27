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
allFiles.forEach(file => {
  if (file.toLowerCase().endsWith('logo.png') || file.toLowerCase().endsWith('logo.jpg') || file.toLowerCase().endsWith('logo.jpeg') || file.toLowerCase().endsWith('logo.svg')) {
    console.log(`Found logo at: ${file}`);
  }
});
