import fs from 'fs';

const content = fs.readFileSync('deploy_temp/package/dist/chunk-VMC7ZO3K.js', 'utf8');

let idx = content.indexOf('projectSettingsSchema');
if (idx !== -1) {
  console.log(content.substring(idx - 100, idx + 1000));
} else {
  console.log("projectSettingsSchema not found");
}
