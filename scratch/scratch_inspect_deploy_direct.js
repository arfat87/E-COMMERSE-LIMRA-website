import { readFileSync } from 'fs';

const src = readFileSync('package/dist/chunk-VMC7ZO3K.js', 'utf8');

const deployDirectIdx = src.indexOf('async function deployDirect');
if (deployDirectIdx > -1) {
  console.log('=== deployDirect definition ===');
  console.log(src.slice(deployDirectIdx, deployDirectIdx + 3000));
} else {
  console.log('deployDirect not found, searching other patterns...');
  const idx = src.indexOf('deployDirect');
  if (idx > -1) {
    console.log(src.slice(idx - 200, idx + 800));
  }
}
