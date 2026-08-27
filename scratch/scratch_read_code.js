import fs from 'fs';

const content = fs.readFileSync('package/dist/chunk-VMC7ZO3K.js', 'utf8');
const lines = content.split('\n');

// Find start and end of registerDeploymentTools or create-deployment related code
const startLine = lines.findIndex(l => l.includes('function registerDeploymentTools'));
const endLine = lines.findIndex((l, i) => i > startLine && l.includes('registerDeploymentTools(ctx)'));

if (startLine !== -1 && endLine !== -1) {
  console.log(`Found registerDeploymentTools from line ${startLine} to ${endLine}`);
  fs.writeFileSync('scratch_extracted_deploy.js', lines.slice(startLine - 50, endLine + 50).join('\n'));
} else {
  console.log('Not found');
}
