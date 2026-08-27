import fs from 'fs';
import path from 'path';

const dirs = ['migrations', 'scratch'];
console.log('=== SEARCHING FOR auto_verify_phone ===');

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    const filePath = path.join(dir, f);
    if (fs.statSync(filePath).isDirectory()) return;
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('auto_verify') || content.includes('verify_phone')) {
      console.log(`[${filePath}]`);
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes('auto_verify') || line.includes('function') || line.includes('trigger')) {
          console.log(`  Line ${idx + 1}: ${line.trim()}`);
        }
      });
    }
  });
});
