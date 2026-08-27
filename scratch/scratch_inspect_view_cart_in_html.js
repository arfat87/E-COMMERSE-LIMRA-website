import fs from 'fs';

const files = ['index.html', 'deploy_temp/index.html'];

files.forEach((file) => {
  if (fs.existsSync(file)) {
    const contents = fs.readFileSync(file, 'utf8');
    const lines = contents.split('\n');
    lines.forEach((line, index) => {
      if (line.includes('view-cart-btn')) {
        console.log(`[${file}:${index + 1}] ${line.trim()}`);
      }
    });
  }
});
