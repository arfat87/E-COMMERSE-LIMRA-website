/**
 * Limra Restaurant POS - Electron Preload Script
 * 
 * Safely exposes native hardware printer capabilities to the web POS
 * without compromising security (contextIsolation: true).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronPOS', {
  isDesktop: true,
  platform: process.platform,

  // Get list of connected printers
  getPrinters: () => ipcRenderer.invoke('get-printers'),

  // Silent print receipt to thermal printer
  printReceipt: (options) => ipcRenderer.invoke('print-receipt', options)
});
