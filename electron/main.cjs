/**
 * Limra Restaurant POS - Electron Desktop Main Process
 * 
 * Features:
 * - Embedded high-speed loopback HTTP server (127.0.0.1) for zero-latency local asset serving
 * - Resolves all relative/absolute CSS, JS module, and image paths seamlessly
 * - 100% Offline persistent storage using Chromium 'persist:limra-pos-data' partition
 * - Silent thermal receipt printing bridge for 80mm/58mm thermal rolls
 * - DevTools shortcut (F12 / Ctrl+Shift+I) for easy debugging
 */

const electron = require('electron');
const { app, BrowserWindow, ipcMain, globalShortcut } = (electron && typeof electron === 'object' && electron.app) ? electron : {};
const http = require('http');
const path = require('path');
const fs = require('fs');

if (app && typeof app.setName === 'function') {
  app.setName('Limra Restaurant POS');
}

let mainWindow = null;
let localServer = null;
let serverPort = null;

// MIME type map for static asset serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp'
};

/**
 * Finds the correct absolute path to the `dist` directory
 * both in local development and when packaged into an .exe/.dmg
 */
function getDistDirectory() {
  const possiblePaths = [
    path.join(__dirname, '../dist'),
    path.join(process.resourcesPath || '', 'app.asar/dist'),
    path.join(process.resourcesPath || '', 'app/dist'),
    path.join(process.resourcesPath || '', 'dist'),
    path.join(app.getAppPath(), 'dist')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'admin.html'))) {
      return p;
    }
  }

  // Fallback to standard parent dist
  return path.join(__dirname, '../dist');
}

/**
 * Starts a lightweight local HTTP server on 127.0.0.1
 * This eliminates all file:// protocol restrictions (CORS, broken absolute paths, MIME issues)
 */
function startLocalServer(distDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        // Parse request URL and strip query parameters
        let rawUrl = (req.url || '/').split('?')[0];
        let reqPath = decodeURIComponent(rawUrl);

        // Normalize default routing
        if (reqPath === '/' || reqPath === '') reqPath = '/admin.html';
        if (reqPath === '/admin') reqPath = '/admin.html';
        if (reqPath === '/admin-login') reqPath = '/admin-login.html';
        if (reqPath === '/table') reqPath = '/table/index.html';
        if (reqPath === '/stock-manager') reqPath = '/stock-manager/index.html';

        let targetFile = path.join(distDir, reqPath);

        // If target is a directory, seek index.html
        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
          targetFile = path.join(targetFile, 'index.html');
        }

        // If asset/file does not exist, check fallback
        if (!fs.existsSync(targetFile)) {
          // If it's an asset (css/js/image) that is missing, return 404
          if (/\.[a-zA-Z0-9]+$/.test(reqPath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end(`Asset not found: ${reqPath}`);
            return;
          }
          // Otherwise, SPA fallback to admin.html
          targetFile = path.join(distDir, 'admin.html');
        }

        const ext = path.extname(targetFile).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(targetFile, (err, data) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Error loading file: ${err.message}`);
          } else {
            res.writeHead(200, {
              'Content-Type': contentType,
              'Cache-Control': 'no-cache',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(data);
          }
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Server Error: ${err.message}`);
      }
    });

    // Listen on dynamic localhost port (port 0 = OS assigns free available port)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      serverPort = address.port;
      console.log(`[Limra POS Desktop] Local HTTP Server running on http://127.0.0.1:${serverPort}`);
      resolve({ server, port: serverPort });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Creates the primary POS Desktop window
 */
async function createWindow() {
  const distDir = getDistDirectory();
  console.log(`[Limra POS Desktop] Serving assets from: ${distDir}`);

  try {
    const { server, port } = await startLocalServer(distDir);
    localServer = server;
    serverPort = port;
  } catch (err) {
    console.error('[Limra POS Desktop] Failed to start local server:', err);
  }

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'Limra Restaurant POS',
    backgroundColor: '#f6f4f0',
    icon: path.join(__dirname, 'icon.png'),
    show: false, // Wait until content is ready to prevent white flash
    webPreferences: {
      // 'persist:' prefix guarantees Chromium NEVER evicts IndexedDB / Dexie records
      partition: 'persist:limra-pos-data',
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  // Clean kiosk appearance (hide default application menu bar)
  mainWindow.setMenuBarVisibility(false);

  // Load via localhost HTTP server (solves all CORS, absolute path, and module loading issues)
  const targetUrl = serverPort 
    ? `http://127.0.0.1:${serverPort}/admin.html` 
    : `file://${path.join(distDir, 'admin.html')}`;

  console.log(`[Limra POS Desktop] Loading URL: ${targetUrl}`);
  mainWindow.loadURL(targetUrl);

  // Show window smoothly when DOM is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  // Enable F12 and Ctrl+Shift+I to open DevTools for troubleshooting
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Thermal Printing Hardware Bridge (Silent Direct ESC/POS & Driver)
// ---------------------------------------------------------------------------

/**
 * Resolves the requested printer name against actual installed system printers.
 * Eliminates driver name mismatches (e.g. 'TVS RP3200 Plus' vs 'RP3200 plus(U) 1')
 * so Chromium's webContents.print({ silent: true }) never opens the OS print dialog.
 */
async function resolvePrinterDevice(requestedName, targetWebContents) {
  try {
    let printers = [];
    if (targetWebContents && typeof targetWebContents.getPrintersAsync === 'function') {
      printers = await targetWebContents.getPrintersAsync();
    } else if (mainWindow && typeof mainWindow.webContents.getPrintersAsync === 'function') {
      printers = await mainWindow.webContents.getPrintersAsync();
    }

    if (!printers || printers.length === 0) {
      return { resolvedName: requestedName || '', found: false, matchedRule: 'empty_printer_list' };
    }

    const req = (requestedName || '').trim();
    const reqLower = req.toLowerCase();

    // 1. Exact match (case-insensitive)
    if (req) {
      const exact = printers.find(p => p.name.toLowerCase() === reqLower);
      if (exact) {
        return { resolvedName: exact.name, found: true, isDefault: Boolean(exact.isDefault), matchedRule: 'exact' };
      }
    }

    // 2. Normalized match (alphanumeric only, e.g. "tvsrp3200plus" vs "rp3200plusu1")
    if (req) {
      const reqNorm = reqLower.replace(/[^a-z0-9]/g, '');
      const normMatch = printers.find(p => {
        const pNorm = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return pNorm.includes(reqNorm) || reqNorm.includes(pNorm);
      });
      if (normMatch) {
        return { resolvedName: normMatch.name, found: true, isDefault: Boolean(normMatch.isDefault), matchedRule: 'normalized' };
      }
    }

    // 3. Known TVS / RP3200 / POS-80 / Thermal patterns
    const tvsMatch = printers.find(p => /rp\s*3200|tvs|pos-?80|thermal|receipt|ticket/i.test(p.name));
    if (tvsMatch) {
      return { resolvedName: tvsMatch.name, found: true, isDefault: Boolean(tvsMatch.isDefault), matchedRule: 'thermal_pattern' };
    }

    // 4. System default printer
    const defaultPrinter = printers.find(p => p.isDefault);
    if (defaultPrinter) {
      return { resolvedName: defaultPrinter.name, found: true, isDefault: true, matchedRule: 'system_default' };
    }

    // 5. Fallback to first available printer
    return { resolvedName: printers[0].name, found: true, isDefault: Boolean(printers[0].isDefault), matchedRule: 'first_available' };
  } catch (err) {
    console.warn('[Limra Desktop Print] Printer device resolution error:', err);
    return { resolvedName: requestedName || '', found: false, matchedRule: 'error_fallback' };
  }
}

let _printWorkerWin = null;
let _cachedResolvedDeviceName = null;
let _cachedResolvedDeviceTime = 0;

function getOrCreatePrintWorkerWindow() {
  if (_printWorkerWin && !_printWorkerWin.isDestroyed()) {
    return _printWorkerWin;
  }
  _printWorkerWin = new BrowserWindow({
    show: false,
    width: 272,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  return _printWorkerWin;
}

if (ipcMain) {
  ipcMain.handle('get-printers', async () => {
    if (!mainWindow) return [];
    return await mainWindow.webContents.getPrintersAsync();
  });

  ipcMain.handle('get-printer-status', async (event, requestedName) => {
    const printers = mainWindow ? await mainWindow.webContents.getPrintersAsync() : [];
    const resolution = await resolvePrinterDevice(requestedName, mainWindow?.webContents);
    _cachedResolvedDeviceName = resolution.resolvedName;
    _cachedResolvedDeviceTime = Date.now();
    return {
      printers,
      resolvedName: resolution.resolvedName,
      matchedRule: resolution.matchedRule,
      isDefault: resolution.isDefault
    };
  });

  ipcMain.handle('print-receipt', async (event, options = {}) => {
    const { html, printerName, silent = true, paperWidth = 80 } = options;

    if (html) {
      return new Promise(async (resolve) => {
        let resolved = false;
        const printWin = getOrCreatePrintWorkerWindow();

        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error: 'Thermal print timed out after 10 seconds' });
          }
        }, 10000);

        // Wrap html with strict print styles ensuring zero margin and direct 72mm thermal roll bounds
        const is58 = String(paperWidth) === '58';
        const paperWidthMm = is58 ? '58' : '72';
        const targetWidthPx = is58 ? 220 : 272;
        try {
          const currentBounds = printWin.getBounds();
          if (currentBounds.width !== targetWidthPx) {
            printWin.setSize(targetWidthPx, 800);
          }
        } catch (e) {}

        const styledHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8" />
            <style>
              @page {
                size: ${paperWidthMm}mm auto;
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
              .limra-print-container {
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
            <div class="limra-print-container">
              ${html}
            </div>
          </body>
          </html>
        `;

        const os = require('os');
        const tmpPrintFile = path.join(os.tmpdir(), `limra-desk-print-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`);
        try { fs.writeFileSync(tmpPrintFile, styledHtml, 'utf8'); } catch (e) {}

        const cleanupTmp = () => {
          try { if (tmpPrintFile && fs.existsSync(tmpPrintFile)) fs.unlinkSync(tmpPrintFile); } catch (e) {}
        };

        const onFinishLoad = async () => {
          // Remove listener after execution to prevent stacking
          printWin.webContents.removeListener('did-finish-load', onFinishLoad);

          // Ensure all Base64 images are decoded before rasterizing to print spooler
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

          let resolvedDevice = _cachedResolvedDeviceName;
          if (!resolvedDevice || (Date.now() - _cachedResolvedDeviceTime > 300000)) {
            const resolution = await resolvePrinterDevice(printerName, printWin.webContents);
            resolvedDevice = resolution.resolvedName;
            _cachedResolvedDeviceName = resolvedDevice;
            _cachedResolvedDeviceTime = Date.now();
          }

          console.log(`[Limra Desktop Print] Dispatching silent print to: "${resolvedDevice}" (requested: "${printerName}")`);

          printWin.webContents.print(
            {
              silent: silent !== false,
              printBackground: true,
              deviceName: resolvedDevice,
              margins: { marginType: 'none' }
            },
            (success, failureReason) => {
              clearTimeout(timer);
              cleanupTmp();
              if (!resolved) {
                resolved = true;
                if (!success) {
                  console.error('[Limra Desktop Print] Failed:', failureReason);
                  // Invalidate cache if printer failed
                  _cachedResolvedDeviceName = null;
                  resolve({ success: false, error: failureReason || 'Printer rejected print job', deviceName: resolvedDevice });
                } else {
                  console.log(`[Limra Desktop Print] Printed silently to ${resolvedDevice} ✓`);
                  resolve({ success: true, hardware_confirmed: true, deviceName: resolvedDevice });
                }
              }
            }
          );
        };

        printWin.webContents.on('did-finish-load', onFinishLoad);

        printWin.webContents.once('did-fail-load', (e, code, desc) => {
          printWin.webContents.removeListener('did-finish-load', onFinishLoad);
          clearTimeout(timer);
          cleanupTmp();
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error: desc || 'Failed to load receipt HTML in printer window' });
          }
        });

        if (fs.existsSync(tmpPrintFile)) {
          printWin.loadFile(tmpPrintFile);
        } else {
          printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(styledHtml)}`);
        }
      });
    }

    if (!mainWindow) return { success: false, error: 'Window not active' };

    const resolution = await resolvePrinterDevice(printerName, mainWindow.webContents);
    return new Promise((resolve) => {
      mainWindow.webContents.print(
        {
          silent: silent !== false,
          printBackground: true,
          deviceName: resolution.resolvedName,
          margins: { marginType: 'none' }
        },
        (success, failureReason) => {
          if (!success) {
            console.error('[Limra Desktop Print] Failed:', failureReason);
            resolve({ success: false, error: failureReason, deviceName: resolution.resolvedName });
          } else {
            console.log(`[Limra Desktop Print] Printed silently to ${resolution.resolvedName} ✓`);
            resolve({ success: true, hardware_confirmed: true, deviceName: resolution.resolvedName });
          }
        }
      );
    });
  });
}

// ---------------------------------------------------------------------------
// App Lifecycle
// ---------------------------------------------------------------------------

if (app) {
  app.whenReady().then(createWindow);

  app.on('activate', () => {
    if (BrowserWindow && BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('window-all-closed', () => {
    if (localServer) {
      try {
        localServer.close();
      } catch (e) {}
    }
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

// Export helper for automated test verification
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    resolvePrinterDevice
  };
}
