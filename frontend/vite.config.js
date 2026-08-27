import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [
    tailwindcss()
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        admin: path.resolve(__dirname, 'admin.html'),
        adminLogin: path.resolve(__dirname, 'admin-login.html'),
        privacy: path.resolve(__dirname, 'privacy.html'),
        table: path.resolve(__dirname, 'table/index.html'),
        qrAdmin: path.resolve(__dirname, 'table/qr-admin.html'),
        stockManager: path.resolve(__dirname, 'stock-manager/index.html')
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('chart.js')) return 'vendor-chart';
            if (id.includes('qrcode')) return 'vendor-qr';
            return 'vendor';
          }
        }
      }
    }
  }
})
