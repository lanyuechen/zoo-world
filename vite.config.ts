import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const root = path.dirname(fileURLToPath(import.meta.url))

/** GitHub Pages 项目页：BASE_PATH=/zoo-world/ ；本地开发默认 / */
const base = process.env.BASE_PATH || '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: '中国动物大百科',
        short_name: '动物大百科',
        description:
          '以《中国生物物种名录》为分类主干的本土动物物种检索（非商业）。',
        theme_color: '#1f4d38',
        background_color: '#e8eee9',
        display: 'standalone',
        lang: 'zh-CN',
        start_url: './',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        // 壳资源预缓存；大体量名录 JSON 走运行时缓存
        globPatterns: ['**/*.{js,css,html,svg,ico,woff2}'],
        globIgnores: ['**/data/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /\/data\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.includes('/data/') && url.pathname.endsWith('.json'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'catalogue-data',
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-css',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
    {
      name: 'spa-github-pages-404',
      closeBundle() {
        const dist = path.join(root, 'dist')
        const index = path.join(dist, 'index.html')
        if (fs.existsSync(index)) {
          fs.copyFileSync(index, path.join(dist, '404.html'))
        }
      },
    },
  ],
})
