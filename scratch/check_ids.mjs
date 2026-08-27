import fs from 'fs';

function findIdsInHtml(htmlContent) {
  const ids = new Set();
  const regex = /id=["']([^"']+)["']/g;
  let match;
  while ((match = regex.exec(htmlContent)) !== null) {
    ids.add(match[1]);
  }
  return ids;
}

function findGetElementByIdInJs(jsContent) {
  const ids = new Set();
  // match getElementById('id'), $('id'), $('#id'), document.querySelector('#id')
  const regexes = [
    /document\.getElementById\(["']([^"']+)["']\)/g,
    /\$\(["']#?([^"'\s#]+)["']\)/g,
    /document\.querySelector\(["']#([^"'\s,]+)["']\)/g
  ];

  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(jsContent)) !== null) {
      ids.add(match[1]);
    }
  }
  return ids;
}

const htmlIndex = fs.readFileSync('index.html', 'utf8');
const jsMain = fs.readFileSync('src/main.js', 'utf8');

const htmlIndexIds = findIdsInHtml(htmlIndex);
const jsMainIds = findGetElementByIdInJs(jsMain);

console.log("--- Checking index.html vs src/main.js ---");
const missingMain = [];
for (const id of jsMainIds) {
  // Ignore dynamically generated or generic selector IDs
  if (!htmlIndexIds.has(id) && !id.includes('${') && !id.includes('+')) {
    missingMain.push(id);
  }
}
console.log("Missing IDs in index.html referenced by src/main.js:", missingMain);

const htmlAdmin = fs.readFileSync('admin.html', 'utf8');
const jsAdmin = fs.readFileSync('src/admin.js', 'utf8');
const htmlAdminIds = findIdsInHtml(htmlAdmin);
const jsAdminIds = findGetElementByIdInJs(jsAdmin);

console.log("\n--- Checking admin.html vs src/admin.js ---");
const missingAdmin = [];
for (const id of jsAdminIds) {
  if (!htmlAdminIds.has(id) && !id.includes('${') && !id.includes('+')) {
    missingAdmin.push(id);
  }
}
console.log("Missing IDs in admin.html referenced by src/admin.js:", missingAdmin);

const htmlTable = fs.readFileSync('table/index.html', 'utf8');
const jsTable = fs.readFileSync('src/table/table.js', 'utf8');
const htmlTableIds = findIdsInHtml(htmlTable);
const jsTableIds = findGetElementByIdInJs(jsTable);

console.log("\n--- Checking table/index.html vs src/table/table.js ---");
const missingTable = [];
for (const id of jsTableIds) {
  if (!htmlTableIds.has(id) && !id.includes('${') && !id.includes('+')) {
    missingTable.push(id);
  }
}
console.log("Missing IDs in table/index.html referenced by src/table/table.js:", missingTable);
