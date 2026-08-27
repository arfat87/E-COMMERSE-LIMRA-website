import fs from 'fs';

function printHead(file) {
  if (fs.existsSync(file)) {
    console.log(`=== Head section of: ${file} ===`);
    const content = fs.readFileSync(file, 'utf8');
    const start = content.indexOf('<head>');
    const end = content.indexOf('</head>');
    if (start > -1 && end > -1) {
      console.log(content.slice(start, end + 7));
    } else {
      console.log('Head not found, printing first 2000 chars:');
      console.log(content.slice(0, 2000));
    }
  }
}

printHead('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/index.html');
printHead('c:/MY_ALL_ITEM/ALL_PROJECT/biuld with Ai/E-COMMERSE LIMRA/app/index.html');
