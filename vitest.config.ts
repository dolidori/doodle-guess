import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'server/src/**/*.test.ts',
      'client/src/**/*.test.ts',
      'client/src/**/*.test.tsx'
    ],
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['dist', 'client/src/main.tsx']
    }
  }
});
