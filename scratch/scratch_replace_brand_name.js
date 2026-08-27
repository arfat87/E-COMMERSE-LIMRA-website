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
    
    // Replace SK Arif with Minara Bibi
    content = content.replace(/SK\s+Arif/g, 'Minara Bibi');
    content = content.replace(/sk\s+arif/g, 'Minara Bibi');
    
    // Replace Menara Bibi with Minara Bibi
    content = content.replace(/Menara\s+Bibi/g, 'Minara Bibi');
    content = content.replace(/menara\s+bibi/g, 'Minara Bibi');
    
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated successfully: ${file}`);
  } else {
    console.log(`File not found: ${file}`);
  }
}
