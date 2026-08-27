import fs from 'fs';
import path from 'path';

const dir = 'migrations';
const files = fs.readdirSync(dir);

console.log('=== SEARCHING FOR PROFILE CREATION/POLICIES ===');
files.forEach(f => {
  const filePath = path.join(dir, f);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.toLowerCase().includes('customer_profiles') || line.toLowerCase().includes('policy')) {
      console.log(`[${f}:${idx + 1}]: ${line.trim()}`);
    }
  });
});
