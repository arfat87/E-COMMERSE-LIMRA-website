import fs from 'fs';

const content = fs.readFileSync('deploy_temp/package/dist/chunk-VMC7ZO3K.js', 'utf8');

const helpers = [
  'shouldExcludeDeploymentPath',
  'hashFile',
  'normalizeRelativePath',
  'parseCreateDirectDeploymentResponse',
  'getDirectUploadConcurrency',
  'runWithConcurrency',
  'handleApiResponse'
];

for (const helper of helpers) {
  let idx = content.indexOf(`function ${helper}`);
  if (idx === -1) {
    idx = content.indexOf(`${helper}`);
  }
  if (idx !== -1) {
    console.log(`=== ${helper} ===`);
    console.log(content.substring(idx - 50, idx + 1000));
  } else {
    console.log(`=== ${helper} not found ===`);
  }
}
