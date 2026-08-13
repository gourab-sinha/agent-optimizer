import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'ghl-cors',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const origin = req.headers.origin || ''
          if (
            origin.includes('gohighlevel.com')
            || origin.includes('leadconnectorhq.com')
            || origin.includes('msgsndr.com')
            || origin.includes('ngrok')
          ) {
            res.setHeader('Access-Control-Allow-Origin', origin)
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
            res.setHeader('Access-Control-Max-Age', '86400')
            res.setHeader('Vary', 'Origin')
          }
          if (req.method === 'OPTIONS' && (req.url || '').startsWith('/api')) {
            res.statusCode = 204
            res.end()
            return
          }
          next()
        })
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    cors: true,
    hmr: {
      clientPort: 5173,
    },
    allowedHosts: ['.ngrok-free.app', '.ngrok.io', 'localhost'],
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
