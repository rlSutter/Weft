import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom will be added at M6 when component tests arrive (per TESTING.md Layer 3.5).
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
  },
});
