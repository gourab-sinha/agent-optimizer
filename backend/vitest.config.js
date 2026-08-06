import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    fileParallelism: true,
    pool: 'forks',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js'],
      exclude: [
        'src/db/examples.js',
        'src/db/migrate.js',
        'src/db/run-migrations.js',
        'src/db/migrations/**',
      ],
      all: true,
      thresholds: {
        lines: 99,
        functions: 100,
        branches: 85,
        statements: 99,
      },
    },
  },
});
