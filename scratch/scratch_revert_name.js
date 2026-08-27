import fs from 'fs';

const filesToUpdate = [
  'index.html',
  'src/main.js',
  'deploy_temp/index.html',
  'deploy_temp/src/main.js'
];

for (const file of filesToUpdate) {
  if (fs.existsSync(file)) {
    console.log(`Processing file: ${file}`);
    let content = fs.readFileSync(file, 'utf8');
    
    // Replace Minara Bibi / minara bibi / Menara Bibi / menara bibi with SK Arif
    content = content.replace(/Minara\s+Bibi/g, 'SK Arif');
    content = content.replace(/minara\s+bibi/g, 'SK Arif');
    content = content.replace(/Menara\s+Bibi/g, 'SK Arif');
    content = content.replace(/menara\s+bibi/g, 'SK Arif');
    
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Successfully reverted to SK Arif in: ${file}`);
  } else {
    console.log(`File not found: ${file}`);
  }
}
