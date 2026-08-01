import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // The API server runs alongside in development; `npm start` serves both
      // from one origin in production, so the client always calls /api.
      // Fixed, matching `npm run dev:api` — deliberately not process.env.PORT,
      // which belongs to this dev server.
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
