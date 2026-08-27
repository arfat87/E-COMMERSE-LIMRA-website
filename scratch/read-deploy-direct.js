import fs from 'fs';

const content = fs.readFileSync('deploy_temp/package/dist/chunk-VMC7ZO3K.js', 'utf8');

let idx = content.indexOf('async function deployDirect(');
if (idx === -1) {
  idx = content.indexOf('deployDirect');
}
if (idx !== -1) {
  console.log(content.substring(idx - 100, idx + 4000));
} else {
  console.log("deployDirect not found");
}
