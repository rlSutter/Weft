import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Base path is configurable so the same build works for:
//   local dev:                base = '/'          (default)
//   GitHub Pages (rlSutter):  base = '/Weft/'     (BASE_URL=/Weft/ pnpm build)
//   custom domain:            base = '/'          (unset)
const BASE = process.env.BASE_URL ?? '/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Weft',
        short_name: 'Weft',
        description: 'A post-platform communications channel',
        theme_color: '#2F6B58',
        background_color: '#DFE5DC',
        display: 'standalone',
        start_url: BASE,
        scope: BASE,
        icons: [],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg}'] },
    }),
  ],
});
