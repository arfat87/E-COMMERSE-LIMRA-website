import { readFileSync } from 'fs';

const src = readFileSync('package/dist/chunk-VMC7ZO3K.js', 'utf8');

const collectIdx = src.indexOf('function collectDeploymentFiles');
if (collectIdx > -1) {
  console.log('=== collectDeploymentFiles definition ===');
  console.log(src.slice(collectIdx, collectIdx + 2000));
} else {
  console.log('collectDeploymentFiles not found');
}
