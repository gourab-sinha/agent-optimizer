import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    // Custom plugin to disable host check
    {
      name: 'disable-host-check',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Allow all hosts
          next()
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0', // Listen on all addresses
    port: 5173,
    strictPort: false,
    hmr: {
      clientPort: 5173,
    },
    // Allow all hosts including ngrok
    allowedHosts: ['.ngrok-free.app', '.ngrok.io', 'localhost'],
    // Proxy API requests to backend
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
  },
})
