import fs from 'fs';

const logoB64 = fs.readFileSync('public/images/logo.png').toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <clipPath id="circleClip">
    <circle cx="256" cy="256" r="256"/>
  </clipPath>
  <image href="data:image/png;base64,${logoB64}" x="0" y="0" width="512" height="512" clip-path="url(#circleClip)"/>
</svg>`;

fs.writeFileSync('public/favicon.svg', svg.trim());
console.log('Created public/favicon.svg successfully.');
