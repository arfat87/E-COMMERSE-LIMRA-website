import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const filesToCheck = [
  'src/main.js',
  'src/admin.js',
  'src/admin-login.js',
  'deploy_temp/src/main.js',
  'deploy_temp/src/admin.js',
  'deploy_temp/src/admin-login.js'
];

console.log('=== RUNNING JS ES6 SYNTAX CHECK via node --check ===');

let errorCount = 0;

filesToCheck.forEach(file => {
  const filePath = path.resolve('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA', file);
  if (!fs.existsSync(filePath)) {
    console.log(`[SKIPPED] ${file} (does not exist)`);
    return;
  }
  
  try {
    execSync(`node --check "${filePath}"`, { stdio: 'pipe' });
    console.log(`[PASS] ${file} is syntactically valid.`);
  } catch (err) {
    console.error(`[FAIL] ${file} has syntax error:`);
    console.error(err.stderr ? err.stderr.toString() : err.message);
    errorCount++;
  }
});

console.log(`\nSyntax scan completed with ${errorCount} errors.`);
process.exit(errorCount > 0 ? 1 : 0);
