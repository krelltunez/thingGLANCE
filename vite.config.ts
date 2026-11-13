import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))
const buildTime = new Date().toISOString()

// `--mode electron` is reserved for the desktop renderer (same convention as
// lastGLANCE): the same bundle with no PWA, because a desktop shell must never
// register the service worker.
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: { port: 5190, strictPort: true },
  preview: { port: 5191, strictPort: true },
  plugins: [
    react(),
    mode !== 'electron' && VitePWA({
      registerType: 'autoUpdate',
      // Registered from main.tsx, web only (src/native/serviceWorker.ts).
      injectRegister: false,
      manifest: false,
      includeAssets: ['favicon.ico', 'favicon/*.png', 'icons/*.png', 'icons/*.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2}'],
        // Latin fonts only in the precache; other scripts load on demand.
        globIgnores: ['**/*cyrillic*', '**/*greek*', '**/*vietnamese*'],
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Product photos pulled by the web lookup: keep them for offline use.
            urlPattern: ({ url }) => url.hostname.endsWith('wikimedia.org'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'thing-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
}))
