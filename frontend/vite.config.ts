import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Force browser to always check for updates in development
    headers: {
      'Cache-Control': 'no-store',
    },
    // Ensure HMR works properly
    hmr: {
      overlay: true,
    },
    // Proxy image paths to the backend so relative URLs in markdown work
    proxy: {
      '/images': 'http://localhost:3002',
      '/blog-images': 'http://localhost:3002',
    },
  },
  esbuild: {
    drop: ['console', 'debugger'],
    legalComments: 'none',
  },
  build: {
    modulePreload: { polyfill: false },
    // Add content hashes to filenames for cache busting in production
    rollupOptions: {
      treeshake: {
        preset: 'smallest',
        manualPureFunctions: [
          'console.log',
          'console.warn',
          'console.info',
          'console.debug',
          'Object.freeze',
        ],
      },
      output: {
        // Ensure CSS files get hashed names
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        experimentalMinChunkSize: 5_000,
      },
    },
  },
})
