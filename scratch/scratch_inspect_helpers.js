import { readFileSync } from 'fs';

const src = readFileSync('package/dist/chunk-VMC7ZO3K.js', 'utf8');

const helpers = ['normalizeRelativePath', 'shouldExcludeDeploymentPath', 'hashFile'];

for (const h of helpers) {
  const idx = src.indexOf(`function ${h}`);
  if (idx > -1) {
    console.log(`=== ${h} definition ===`);
    console.log(src.slice(idx, idx + 1000));
  } else {
    // try var definition
    const idx2 = src.indexOf(`var ${h}`);
    if (idx2 > -1) {
      console.log(`=== ${h} definition ===`);
      console.log(src.slice(idx2 - 100, idx2 + 500));
    } else {
      console.log(`${h} not found`);
    }
  }
}
