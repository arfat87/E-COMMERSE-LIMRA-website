import fs from 'fs';
import path from 'path';

const dirs = ['migrations', 'scratch'];
console.log('=== SEARCHING FOR handle_new_user DEFINITION ===');

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    const filePath = path.join(dir, f);
    if (fs.statSync(filePath).isDirectory()) return;
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('handle_new_user')) {
      console.log(`[${filePath}]`);
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes('handle_new_user') || line.includes('customer_profiles') || line.includes('insert')) {
          console.log(`  Line ${idx + 1}: ${line.trim()}`);
        }
      });
    }
  });
});
