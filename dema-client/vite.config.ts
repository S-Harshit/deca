import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS is on by default: getUserMedia (video calls) only works in a secure context,
// and plain http://192.168.x.x is not one. Set HTTP=1 to opt out.
// The signaling WebSocket is proxied through Vite at /ws so the page never mixes wss/ws.
// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths: the same build works at a domain root (Vercel) or under /repo-name/ (GitHub Pages).
  base: './',
  plugins: [react(), ...(process.env.HTTP ? [] : [basicSsl()])],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/ice': 'http://localhost:8080',
      '/games.json': 'http://localhost:8080',
      '/games': 'http://localhost:8080',
    },
  },
})
