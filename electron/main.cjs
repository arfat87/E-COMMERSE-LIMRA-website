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

const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');

app.setName('Limra Restaurant POS');

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
// Thermal Printing Hardware Bridge (Silent ESC/POS)
// ---------------------------------------------------------------------------

ipcMain.handle('get-printers', async () => {
  if (!mainWindow) return [];
  return await mainWindow.webContents.getPrintersAsync();
});

ipcMain.handle('print-receipt', async (event, options = {}) => {
  if (!mainWindow) return { success: false, error: 'Window not active' };

  const { printerName, silent = true } = options;

  return new Promise((resolve) => {
    mainWindow.webContents.print(
      {
        silent: Boolean(silent),
        printBackground: true,
        deviceName: printerName || '',
        margins: { marginType: 'none' }
      },
      (success, failureReason) => {
        if (!success) {
          console.error('[Limra Desktop Print] Failed:', failureReason);
          resolve({ success: false, error: failureReason });
        } else {
          console.log('[Limra Desktop Print] Printed successfully');
          resolve({ success: true });
        }
      }
    );
  });
});

// ---------------------------------------------------------------------------
// App Lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
