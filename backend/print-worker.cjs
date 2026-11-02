/**
 * Dedicated Lightweight Background Print Worker for Windows
 * Renders full HTML with images, logos, and QR codes directly
 * to the Windows print spooler via Chromium's vector thermal print engine.
 * Zero dialogs, zero UI, exact 72mm printable width.
 * 
 * Supports both:
 * 1. Persistent Daemon Mode (--daemon): Stays warm in memory with internal localhost HTTP endpoint (<40ms latency)
 * 2. Single-Run Mode: CLI payload execution for testing / fallback
 */

const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Disable hardware acceleration and GPU for maximum headless speed (<200ms)
// Keep software rasterizer enabled so Chromium can decode and render Base64 images/QR codes
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

/**
 * Wraps HTML in thermal-optimized layout with exact 71.95mm/72mm physical head bounds
 */
function buildThermalDocument(html, paperWidth = 80) {
  const is58 = String(paperWidth) === '58';
  // Physical TVS RP3200 Plus printable head is 71.95mm (72mm). Standard roll is 80mm.
  // Setting 72mm prevents Chromium GDI downscaling while using the full 576 dots.
  const widthMm = is58 ? '58' : '72';
  const targetWidthPx = is58 ? 220 : 272;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <style>
        @page {
          size: ${widthMm}mm auto;
          margin: 0mm;
        }
        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: #fff;
          color: #000;
          width: 100% !important;
          font-family: 'Courier New', Courier, monospace, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .thermal-page-wrapper {
          width: ${targetWidthPx}px !important;
          max-width: ${targetWidthPx}px !important;
          margin: 0 !important;
          padding: 0 !important;
          color: #000;
          text-align: left;
        }
      </style>
    </head>
    <body>
      <div class="thermal-page-wrapper">
        ${html}
      </div>
    </body>
    </html>
  `;
}

/**
 * Resolves printer device against system printers
 */
function resolveDevice(printerName, printers = []) {
  if (!printers || printers.length === 0) return printerName || 'RP3200 plus(U) 1';
  const req = (printerName || '').trim().toLowerCase();
  if (req) {
    const exact = printers.find(p => p.name.toLowerCase() === req);
    if (exact) return exact.name;
    const reqNorm = req.replace(/[^a-z0-9]/g, '');
    const norm = printers.find(p => p.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(reqNorm));
    if (norm) return norm.name;
  }
  const tvsMatch = printers.find(p => /rp\s*3200|tvs|pos-?80|thermal|receipt/i.test(p.name));
  if (tvsMatch) return tvsMatch.name;
  const def = printers.find(p => p.isDefault);
  if (def) return def.name;
  return printers[0]?.name || printerName || 'RP3200 plus(U) 1';
}

app.on('window-all-closed', (e) => {
  if (process.argv.includes('--daemon')) {
    e?.preventDefault();
  } else {
    app.quit();
  }
});

app.whenReady().then(async () => {
  const isDaemon = process.argv.includes('--daemon');

  if (isDaemon) {
    // ════════════════════════════════════════════════════════════════════════
    // PERSISTENT WORKER DAEMON MODE (Zero Process Launch Overhead)
    // ════════════════════════════════════════════════════════════════════════
    const printWin = new BrowserWindow({
      show: false,
      width: 272,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    let systemPrinters = [];
    try {
      systemPrinters = await printWin.webContents.getPrintersAsync();
    } catch (e) {
      console.error('[PrintWorkerDaemon] Failed to pre-fetch printers:', e.message);
    }

    const printQueue = [];
    let isPrinting = false;

    const processJob = (job) => {
      return new Promise((resolve) => {
        let tmpHtmlPath = null;
        try {
          const { html, printerName, paperWidth = 80 } = job;
          const is58 = String(paperWidth) === '58';
          const targetWidthPx = is58 ? 220 : 272;
          try {
            const currentBounds = printWin.getBounds();
            if (currentBounds.width !== targetWidthPx) {
              printWin.setSize(targetWidthPx, 800);
            }
          } catch (e) {}

          const styledHtml = buildThermalDocument(html, paperWidth);

          tmpHtmlPath = path.join(os.tmpdir(), `limra-daemon-print-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`);
          fs.writeFileSync(tmpHtmlPath, styledHtml, 'utf8');

          const targetDevice = resolveDevice(printerName, systemPrinters);

          const cleanup = () => {
            try { if (tmpHtmlPath && fs.existsSync(tmpHtmlPath)) fs.unlinkSync(tmpHtmlPath); } catch (e) {}
          };

          const timeout = setTimeout(() => {
            cleanup();
            resolve({ success: false, error: 'Daemon print job timed out after 8s' });
          }, 8000);

          const onLoaded = async () => {
            printWin.webContents.removeListener('did-finish-load', onLoaded);
            // Ensure Base64 images are decoded
            try {
              await printWin.webContents.executeJavaScript(`
                new Promise((resolve) => {
                  const imgs = Array.from(document.querySelectorAll('img'));
                  if (!imgs.length) return resolve();
                  let count = imgs.length;
                  imgs.forEach(img => {
                    if (img.complete) {
                      if (--count === 0) resolve();
                    } else {
                      img.onload = img.onerror = () => { if (--count === 0) resolve(); };
                    }
                  });
                })
              `);
              await new Promise(r => setTimeout(r, 40));
            } catch (e) {}

            printWin.webContents.print(
              {
                silent: true,
                printBackground: true,
                deviceName: targetDevice,
                margins: { marginType: 'none' }
              },
              (success, failureReason) => {
                clearTimeout(timeout);
                cleanup();
                resolve({
                  success: Boolean(success),
                  failureReason: failureReason || null,
                  deviceName: targetDevice
                });
              }
            );
          };

          printWin.webContents.on('did-finish-load', onLoaded);
          printWin.loadFile(tmpHtmlPath);
        } catch (err) {
          try { if (tmpHtmlPath && fs.existsSync(tmpHtmlPath)) fs.unlinkSync(tmpHtmlPath); } catch (e) {}
          resolve({ success: false, error: err.message });
        }
      });
    };

    const runQueue = async () => {
      if (isPrinting || printQueue.length === 0) return;
      isPrinting = true;
      const { job, resolve } = printQueue.shift();
      try {
        const result = await processJob(job);
        resolve(result);
      } catch (e) {
        resolve({ success: false, error: e.message });
      } finally {
        isPrinting = false;
        setImmediate(runQueue);
      }
    };

    const server = http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/print') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const job = JSON.parse(body);
            const result = await new Promise((resolve) => {
              printQueue.push({ job, resolve });
              runQueue();
            });
            res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (parseErr) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
          }
        });
        return;
      }

      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'OK', pid: process.pid, printers: systemPrinters.map(p => p.name) }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address.port;
      // Output standardized JSON ready signal for parent process
      console.log(JSON.stringify({ status: 'READY', port, pid: process.pid }));
    });

  } else {
    // ════════════════════════════════════════════════════════════════════════
    // SINGLE-RUN CLI MODE (Legacy / Fallback)
    // ════════════════════════════════════════════════════════════════════════
    let tmpHtmlPath = null;
    try {
      const payloadFile = process.argv[2];
      if (!payloadFile || !fs.existsSync(payloadFile)) {
        console.error('[PrintWorker] Payload file missing');
        app.exit(1);
        return;
      }

      const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
      const { html, printerName, paperWidth = 80 } = payload;
      const styledHtml = buildThermalDocument(html, paperWidth);

      tmpHtmlPath = path.join(os.tmpdir(), `limra-receipt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`);
      fs.writeFileSync(tmpHtmlPath, styledHtml, 'utf8');

      const is58 = String(paperWidth) === '58';
      const targetWidthPx = is58 ? 220 : 272;
      const printWin = new BrowserWindow({
        show: false,
        width: targetWidthPx,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      const timeout = setTimeout(() => {
        console.error('[PrintWorker] Print timed out');
        try { if (tmpHtmlPath && fs.existsSync(tmpHtmlPath)) fs.unlinkSync(tmpHtmlPath); } catch (e) {}
        try { printWin.close(); } catch (e) {}
        app.exit(1);
      }, 8000);

      printWin.webContents.on('did-finish-load', async () => {
        try {
          await printWin.webContents.executeJavaScript(`
            new Promise((resolve) => {
              const imgs = Array.from(document.querySelectorAll('img'));
              if (!imgs.length) return resolve();
              let count = imgs.length;
              imgs.forEach(img => {
                if (img.complete) {
                  if (--count === 0) resolve();
                } else {
                  img.onload = img.onerror = () => { if (--count === 0) resolve(); };
                }
              });
            })
          `);
          await new Promise(r => setTimeout(r, 60));
        } catch (imgErr) {}

        let targetDevice = printerName;
        try {
          const printers = await printWin.webContents.getPrintersAsync();
          targetDevice = resolveDevice(printerName, printers);
        } catch (e) {}

        console.log(`[PrintWorker] Printing to ${targetDevice}...`);

        printWin.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName: targetDevice,
            margins: { marginType: 'none' }
          },
          (success, failureReason) => {
            clearTimeout(timeout);
            try { if (tmpHtmlPath && fs.existsSync(tmpHtmlPath)) fs.unlinkSync(tmpHtmlPath); } catch (e) {}
            try { printWin.close(); } catch (e) {}
            if (!success) {
              console.error('[PrintWorker] Print failed:', failureReason);
              app.exit(1);
            } else {
              console.log('[PrintWorker] Printed successfully to', targetDevice);
              app.exit(0);
            }
          }
        );
      });

      await printWin.loadFile(tmpHtmlPath);
    } catch (err) {
      try { if (tmpHtmlPath && fs.existsSync(tmpHtmlPath)) fs.unlinkSync(tmpHtmlPath); } catch (e) {}
      console.error('[PrintWorker] Uncaught error:', err.message);
      app.exit(1);
    }
  }
});
