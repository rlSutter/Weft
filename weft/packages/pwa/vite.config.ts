import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
        start_url: '/',
        icons: [],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg}'] },
    }),
  ],
});
