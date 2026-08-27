import fs from 'fs';

const content = fs.readFileSync('deploy_temp/package/dist/chunk-VMC7ZO3K.js', 'utf8');

const constants = [
  'EXCLUDED_DEPLOYMENT_SEGMENTS',
  'DEFAULT_DIRECT_UPLOAD_CONCURRENCY',
  'MAX_DIRECT_UPLOAD_CONCURRENCY',
  'createDirectDeploymentResponseSchema'
];

for (const c of constants) {
  let idx = content.indexOf(c);
  if (idx !== -1) {
    console.log(`=== ${c} ===`);
    console.log(content.substring(idx - 50, idx + 400));
  } else {
    console.log(`=== ${c} not found ===`);
  }
}
