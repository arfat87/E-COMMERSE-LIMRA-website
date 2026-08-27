import http from 'http';

function probe(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      console.log(`URL: ${url} | STATUS: ${res.statusCode}`);
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.log('ERROR BODY:', body.slice(0, 300));
        } else {
          console.log('OK (length:', body.length, ')');
        }
        resolve(res.statusCode);
      });
    }).on('error', (err) => {
      console.error(`URL: ${url} | ERROR: ${err.message}`);
      resolve(500);
    });
  });
}

async function run() {
  await probe('http://localhost:5173/table/index.html');
  await probe('http://localhost:5173/src/table/table.js');
}

run();
