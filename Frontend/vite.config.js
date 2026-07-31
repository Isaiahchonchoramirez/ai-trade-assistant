import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `npm run build:demo` produces a backend-free build that reads a frozen
// snapshot instead of calling the API, for hosting on a static server.
// A relative base keeps it working at whatever path it ends up served from.
export default defineConfig({
  base: process.env.VITE_DEMO_BASE || '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The API is proxied rather than called cross-origin, so the app works
    // with no CORS setup and no environment variable to configure.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
