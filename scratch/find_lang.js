import fs from 'node:fs';

['src/main.js', 'src/admin.js', 'index.html', 'admin.html', 'src/table/table.js'].forEach(f => {
  if (!fs.existsSync(f)) return;
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (/lang|translate|bengali|hindi|english|language/i.test(line) && !line.includes('lang="en"')) {
      console.log(`${f}:${idx + 1} -> ${line.trim().slice(0, 120)}`);
    }
  });
});
