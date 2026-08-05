import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue(),
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
  server: {
    host: '0.0.0.0',
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
