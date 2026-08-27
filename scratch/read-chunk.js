import fs from 'fs';

const content = fs.readFileSync('deploy_temp/package/dist/chunk-VMC7ZO3K.js', 'utf8');

// Search for create-deployment tool registration in the else branch (when isRemote is false)
let idx = 0;
while (true) {
  idx = content.indexOf('create-deployment', idx);
  if (idx === -1) break;
  console.log(`=== MATCH AT ${idx} ===`);
  console.log(content.substring(idx - 100, idx + 2000));
  idx += 17;
}
